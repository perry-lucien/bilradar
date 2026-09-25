/**
 * BiliRadar 抽奖识别与过滤
 * - 官方互动抽奖（rid）优先
 * - 文本规则降级（抽奖类 + 参与类关键词）
 * - 汇总帖判别 / 开奖时间提取 / 高风险一票否决
 */
const log = require("./logger");

/** 抽奖关键词（借鉴 LotteryAutoScript，拆两组：抽奖类 + 参与类） */
const RAFFLE_KEYWORDS = [
  { group: "抽奖类", re: /抽奖|送[奖货]?|福利|抽送|j奖|免费送|大奖/i },
  { group: "参与类", re: /转关评粉|转发|评论|关注|三连|点赞|@|参与/i },
];

/** 开奖时间提取 */
const TIME_PATTERNS = [
  /开奖(?:时间|日期)?[：:]\s*([0-9]{1,2}[月.\-/][0-9]{1,2}(?:[日号][^\s，。]*)?)/,
  /开奖(?:时间|日期)?[：:]\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日[^\s，。]*)/,
  /([0-9]{1,2}月[0-9]{1,2}(?:日)?[^\s，。]{0,6}开奖)/,
  /([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日[^\s，。]{0,4}开奖)/,
  // 合集条目格式：→2026年09月08日 00:00→奖品（2026-09-04 新增，文章源直建候选用）
  /→\s*(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}[:：]\d{1,2})/,
  // 通用：4位年+月日+时分（条目/动态文本）
  /(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}[:：]\d{1,2})/,
  // 糯米格式：LT:2026-09-18 10:00:00（2026-09-17 新增，替代合集源）
  /LT[:：]\s*(\d{4}[-.]\d{1,2}[-.]\d{1,2}\s*\d{1,2}[:：]\d{1,2})/,
];

/** 汇总帖特征（合集/汇总，非单条抽奖） */
const SUMMARY_PATTERNS = [
  /^[【\[]\s*[^】\]]*(合集|汇总|官方抽奖|非官方抽奖|临期|速看|全部版|精选|置顶)[^】\]]*[】\]]/,
  /史上最全|全部版|精选大奖版|置顶传送门|今日全部/,
];

function extractOpenTime(text) {
  for (const re of TIME_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return "";
}

/**
 * 把"开奖时间"文本解析成 Date
 * - B站开奖时间为北京时间；服务器可能非东八区，统一按北京时间构造（epoch 与地域无关）
 * - 支持时分："9月4日18:00"→ 北京时间 9-4 18:00；无时分按当天 23:59（北京时间），
 *   当天未结束不算过期（保守，修复"当日开奖被 0 点即误杀"的 bug）
 * - shortDate 为 true 时按当前年解析（用于过期判断，不推明年）
 * - 解析失败返回 null
 */
function parseOpenTime(str, forExpiry = false) {
  if (!str) return null;
  const now = new Date();
  // 北京时间 → epoch：Date.UTC(...) - 8h（北京时间 = UTC+8）
  const bj = (y, mo, d, h, mi) =>
    new Date(Date.UTC(y, mo - 1, d, h, mi) - 8 * 3600 * 1000);
  // ISO：2026-09-18 10:00（糯米 LT 格式，2026-09-17 新增）
  let m = str.match(/(\d{4})[-.](\d{1,2})[-.](\d{1,2})\s*(?:(\d{1,2})[:：]\s*(\d{1,2})?)?/);
  if (m) {
    const hasTime = !!m[4];
    let dt = bj(+m[1], +m[2], +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] || 0 : 59);
    if (!forExpiry && dt < now) dt = bj(+m[1] + 1, +m[2], +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] || 0 : 59);
    return dt;
  }
  m = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?\s*(?:(\d{1,2})[:：点时]\s*(\d{1,2})?)?/);
  if (m) {
    const hasTime = !!m[4];
    let dt = bj(+m[1], +m[2], +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] || 0 : 59);
    // 非过期判断时：若已过且明显是"今年初"的短日期，视为明年（展示用）
    if (!forExpiry && dt < now) dt = bj(+m[1] + 1, +m[2], +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] || 0 : 59);
    return dt;
  }
  m = str.match(/(\d{1,2})[月.\-](\d{1,2})(?:日|号)?\s*(?:(\d{1,2})[:：点时]\s*(\d{1,2})?)?/);
  if (m) {
    const year = now.getFullYear();
    const hasTime = !!m[3];
    let dt = bj(year, +m[1], +m[2], hasTime ? +m[3] : 23, hasTime ? +m[4] || 0 : 59);
    if (!forExpiry && dt < now) dt = bj(year + 1, +m[1], +m[2], hasTime ? +m[3] : 23, hasTime ? +m[4] || 0 : 59);
    return dt;
  }
  return null;
}

/** 按开奖时间判断是否已过期（按当前年解析；无开奖时间则返回 false） */
function isExpiredByOpenTime(openTime) {
  const dt = parseOpenTime(openTime, true);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

/** 是否为汇总帖（需要被排除，避免把合集当单条抽奖推送） */
function isSummaryPost(d) {
  if (!d.text) return false;
  const t = d.text.slice(0, 400);
  // 标题级合集标识（【…合集…】等）
  if (SUMMARY_PATTERNS.some((re) => re.test(t))) return true;
  // 多个"开奖时间/日期"块 → 汇总
  const blocks = (t.match(/开奖[时间日期]/g) || []).length;
  if (blocks >= 3) return true;
  // 含"传送门"且引用多个链接 → 汇总
  if (/传送门/.test(t) && (t.match(/https?:\/\//g) || []).length >= 3) return true;
  return false;
}

/** 高风险一票否决：抽奖+充电/橱窗/购买等诱导消费 */
function applyVeto(text, vetoRules) {
  if (!Array.isArray(vetoRules) || !vetoRules.length) return null;
  for (const rule of vetoRules) {
    const must = rule.must || [];
    const any = rule.any || [];
    const hitMust = must.some((k) => text.includes(k));
    const hitAny = any.some((k) => text.includes(k));
    if (hitMust && hitAny) return rule;
  }
  return null;
}

/** 规则提取奖品（保守策略：只认"奖品：/送出"等高确定性格式，宁缺毋滥；提取失败返回 ""，由原文兜底，绝不误导用户） */
function extractPrize(text) {
  if (!text) return "";
  const patterns = [
    /奖品[：:]\s*([^。！？\n，,；;]{2,40})/,           // 奖品：XXX
    /送出[：:]\s*([^。！？\n，,；;]{2,40})/,           // 送出：XXX
    /送出\s*([^。！？\n，,；;]{2,30})/,                // 送出XXX（如"送出华擎B850M-A主板"）
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim().length >= 2) return m[1].trim();
  }
  return "";
}

/** 规则提取参与要求（关注/转发/评论/三连等，出现则列出） */
function extractEntry(text) {
  if (!text) return "";
  const actions = [];
  if (/关注/.test(text)) actions.push("关注");
  if (/转发/.test(text)) actions.push("转发");
  if (/评论/.test(text)) actions.push("评论");
  if (/三连/.test(text)) actions.push("三连");
  if (/点赞/.test(text)) actions.push("点赞");
  if (/收藏/.test(text)) actions.push("收藏");
  if (/弹幕/.test(text)) actions.push("弹幕");
  if (/@/.test(text)) actions.push("@好友");
  if (/带话题/.test(text)) actions.push("带话题");
  return actions.join("+");
}

/**
 * 抽奖识别
 * @returns {{isRaffle:boolean, source:'official'|'text'|'none', matched:string[]}}
 */
function detectRaffle(d) {
  const matched = [];
  // 0) 转发动态不是抽奖主体（真正的抽奖在原文 origin，1.0 不追踪转发；"转发福利[吃瓜]"类勿误判）
  if (d.type === "DYNAMIC_TYPE_FORWARD") {
    return { isRaffle: false, source: "none", matched: [], forward: true };
  }
  // 1) 官方互动抽奖优先（rid）
  if (d.lotteries && d.lotteries.length) {
    return { isRaffle: true, source: "official", matched: d.lotteries.map((l) => "rid=" + l.rid) };
  }
  const add = d.additional;
  if (add && add.type && /LOTTERY|COMMON|VOTE/.test(add.type)) {
    return { isRaffle: true, source: "official", matched: [add.type] };
  }
  // 2) 文本规则（需同时命中抽奖类 + 参与类）
  let hitGroup1 = false;
  let hitGroup2 = false;
  for (const kw of RAFFLE_KEYWORDS) {
    if (kw.group === "抽奖类" && kw.re.test(d.text)) {
      hitGroup1 = true;
      matched.push(kw.re.source);
    }
    if (kw.group === "参与类" && kw.re.test(d.text)) {
      hitGroup2 = true;
    }
  }
  if (hitGroup1 && hitGroup2) {
    return { isRaffle: true, source: "text", matched };
  }
  return { isRaffle: false, source: "none", matched };
}

/** 组装推送给用户的结构化信息 */
function buildPushPayload(d, det) {
  const openTime = extractOpenTime(d.text);
  return {
    id: d.id,
    authorName: d.authorName,
    authorMid: d.authorMid,
    source: det.source,
    lotteries: d.lotteries,
    openTime,
    text: d.text,
    link: `https://www.bilibili.com/opus/${d.id}`,
  };
}

/** 开奖时间的毫秒时间戳（按当前年解析；解析失败返回 null）——用于排序与入库清理 */
function openTimeMs(text) {
  const dt = parseOpenTime(extractOpenTime(text), true);
  return dt ? dt.getTime() : null;
}

module.exports = {
  detectRaffle,
  extractOpenTime,
  parseOpenTime,
  isExpiredByOpenTime,
  openTimeMs,
  isSummaryPost,
  applyVeto,
  extractPrize,
  extractEntry,
  buildPushPayload,
};
