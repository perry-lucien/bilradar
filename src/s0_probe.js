#!/usr/bin/env node
/**
 * BiliRadar S0 技术验证脚本
 * 功能：抓取指定话题的动态 → 解析 → 识别抽奖 → 终端打印
 * 验证点：①话题feed接口可用性 ②抽奖识别规则 ③字段提取（奖品/要求/链接）
 *
 * 用法：node s0_probe.js <topic_id> [page_size]
 * 依赖：Node.js >= 18（内置 fetch）
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FEATURES =
  "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard";

/**
 * 抓取话题动态列表
 * @param {number|string} topicId
 * @param {string} offset 翻页游标（首次为空）
 * @param {number} pageSize
 */
async function fetchTopicFeed(topicId, offset = "", pageSize = 20) {
  const url =
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/topic` +
    `?topic_id=${topicId}&sort_by=0&offset=${encodeURIComponent(offset)}` +
    `&page_size=${pageSize}&source=Web&features=${FEATURES}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://t.bilibili.com/" },
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`API code=${json.code} msg=${json.message}`);
  return json.data.topic_card_list;
}

/**
 * 官方「互动抽奖」组件：扫描富文本节点中的 RICH_TEXT_NODE_TYPE_LOTTERY
 * 【S0 实测确认】当前 API 不再返回 additional.lottery，
 * 官方抽奖以富文本节点形式内嵌在 major.opus.summary.rich_text_nodes / desc 中，
 * 节点 type = RICH_TEXT_NODE_TYPE_LOTTERY，rid = 抽奖ID。
 */
function extractRichTextLottteries(richNodes) {
  if (!Array.isArray(richNodes)) return [];
  return richNodes
    .filter((n) => n && n.type === "RICH_TEXT_NODE_TYPE_LOTTERY")
    .map((n) => ({ rid: n.rid || n.rid_str || "", text: n.orig_text || n.text || "" }));
}

/**
 * 从一条动态卡片提取结构化信息
 */
function extractDynamic(dc) {
  const modules = dc.modules || {};
  const author = modules.module_author || {};
  const dyn = modules.module_dynamic || {};
  const stat = modules.module_stat || {};
  const desc = dyn.desc || {};
  const additional = dyn.additional || null;

  let majorText = "";
  let lotteries = [];
  const major = dyn.major || {};
  if (major.archive) {
    majorText = [major.archive.title, major.archive.desc].filter(Boolean).join(" ");
  } else if (major.draw) {
    majorText = major.draw.title || "";
  } else if (major.article) {
    majorText = (major.article.title || "") + " " + (major.article.desc || "");
  } else if (major.opus) {
    majorText = (major.opus.title || "") + " " + (major.opus.summary?.text || "");
    lotteries = extractRichTextLottteries(major.opus.summary?.rich_text_nodes || []);
  } else if (major.common) {
    majorText = major.common.title || "";
  }
  // desc 富文本里也可能带抽奖节点
  if (!lotteries.length && desc.rich_text_nodes) {
    lotteries = extractRichTextLottteries(desc.rich_text_nodes);
  }

  const text = [desc.text, majorText].filter(Boolean).join("\n").trim();
  const authorMid = author.mid || author.mid_str || "";
  return {
    id: dc.id_str || "",
    type: dc.type || "",
    authorName: author.name || "",
    authorMid: String(authorMid),
    authorJump: author.jump_url || "",
    text,
    commentCount: stat.comment?.count ?? 0,
    forwardCount: stat.forward?.count ?? 0,
    likeCount: stat.like?.count ?? 0,
    additional, // 旧版官方组件（当前API多为 null）
    lotteries, // 新版官方互动抽奖 rid 列表 【S0 关键发现】
    jumpUrl: (dc.basic && dc.basic.jump_url) || "",
  };
}

/**
 * 抽奖识别规则（借鉴 LotteryAutoScript 关键词，拆成两组）
 */
const RAFFLE_KEYWORDS = [
  { group: "抽奖类", re: /抽奖|送[奖]?|福利|揪|抽送/i },
  { group: "参与类", re: /转关评粉|转发|评论|关注|三连|@|点赞/i },
];

/** 官方抽奖组件类型（additional.type） */
const OFFICIAL_LOTTERY_TYPES = [
  "ADDITIONAL_TYPE_LOTTERY",
  "ADDITIONAL_TYPE_COMMON",
  "ADDITIONAL_TYPE_VOTE",
];

/**
 * 判断是否为抽奖动态
 * @returns {{isRaffle:boolean, source:'official'|'text'|'none', matched:string[]}}
 */
function detectRaffle(d) {
  const matched = [];
  // 1) 官方组件优先：新版互动抽奖（rid）或旧版 additional
  if (d.lotteries && d.lotteries.length) {
    return { isRaffle: true, source: "official", matched: d.lotteries.map((l) => "rid=" + l.rid) };
  }
  const add = d.additional;
  if (add && add.type && OFFICIAL_LOTTERY_TYPES.includes(add.type)) {
    return { isRaffle: true, source: "official", matched: [add.type] };
  }
  // 2) 文本规则（需同时命中"抽奖类"和"参与类"）
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

/**
 * 抓取单条动态详情（用于官方抽奖组件字段验证）
 */
async function fetchDynamicDetail(id) {
  const url =
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail` +
    `?id=${id}&timezone_offset=-480&features=${FEATURES}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" },
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`API code=${json.code} msg=${json.message}`);
  const item = json.data.item || {};
  return extractDynamic({
    id_str: item.id_str || item.id || "",
    type: item.type || "",
    modules: item.modules || {},
    basic: item.basic || {},
  });
}

async function main() {
  // --detail <id> 模式：验证单条动态（含官方抽奖组件）
  if (process.argv[2] === "--detail") {
    const id = process.argv[3];
    if (!id) {
      console.error("用法: node s0_probe.js --detail <dynamic_id>");
      process.exit(1);
    }
    const d = await fetchDynamicDetail(id);
    const det = detectRaffle(d);
    console.log(`[S0] 单条验证 id=${id}`);
    console.log(`  作者: ${d.authorName}(mid:${d.authorMid}) | 类型: ${d.type}`);
    console.log(`  是否抽奖: ${det.isRaffle} | 来源: ${det.source} | 命中: ${det.matched.join(",")}`);
    if (d.lotteries.length) {
      console.log(`  官方互动抽奖 rid: ${d.lotteries.map((l) => l.rid).join(",")}`);
    }
    console.log(`  原文: ${d.text.slice(0, 300).replace(/\n/g, " ")}`);
    return;
  }

  const topicId = process.argv[2];
  const pageSize = parseInt(process.argv[3] || "20", 10);
  if (!topicId) {
    console.error("用法: node s0_probe.js <topic_id> [page_size] | node s0_probe.js --detail <dynamic_id>");
    process.exit(1);
  }
  console.log(`[S0] 抓取话题 ${topicId}，每页 ${pageSize} 条...`);
  const feed = await fetchTopicFeed(topicId, "", pageSize);
  const items = (feed.items || []).map((it) => extractDynamic(it.dynamic_card_item));
  console.log(`[S0] 拉取到动态 ${items.length} 条 | has_more=${feed.has_more}`);

  let raffleCount = 0;
  for (const d of items) {
    const det = detectRaffle(d);
    if (det.isRaffle) {
      raffleCount++;
      console.log("--------------------------------------------------");
      console.log(`#${raffleCount} [${det.source}] ${d.authorName}(mid:${d.authorMid})`);
      console.log(`  类型: ${d.type} | id: ${d.id}`);
      console.log(`  原文: ${d.text.slice(0, 160).replace(/\n/g, " ")}`);
      console.log(`  链接: https://www.bilibili.com/opus/${d.id}`);
    }
  }
  console.log("==================================================");
  console.log(`[S0] 识别结果：共 ${items.length} 条动态，命中抽奖 ${raffleCount} 条`);
}

main().catch((e) => {
  console.error("[S0] 运行出错:", e.message);
  process.exit(1);
});
