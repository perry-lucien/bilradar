/**
 * BiliRadar 主流程（S1）
 * 采集（种子清单 + 话题 + 合集UP主评论传送门）→ 去重 → 识别 → 过滤 → Telegram 推送
 * 用法：node src/index.js    （适合 cron 定时，跑完即走）
 */
const config = require("./config");
const log = require("./logger");
const bili = require("./bili");
const detect = require("./detect");
const db = require("./db");
const tg = require("./telegram");
const path = require("path");
const fs = require("fs");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 粉丝数缓存（单轮内存缓存，同 UP 多动态只查一次）
const fansCache = new Map();

/** 源0 · 种子清单：手动维护的抽奖动态 id（已验证真实） */
async function collectFromWatchlist(cfg) {
  const found = [];
  for (const id of cfg.sources.watchlist || []) {
    try {
      // 已处理过（推送/过滤）的跳过，避免每轮重复拉取
      if (db.isSeen(id)) continue;
      const d = await bili.fetchDynamicDetail(id);
      if (d.id) found.push(d);
      await sleep(400 + Math.random() * 500);
    } catch (e) {
      log.warn(`watchlist ${id} 失败: ${e.message}`);
      if (/412|101|风控|risk/i.test(e.message)) db.markSeenIfNew(id);
    }
  }
  return found;
}

/** 源1 · 话题 feed（2026-09 打通：sort_by=3 最新，云端免 WAF）
 * 话题卡片是摘要（无正文/无抽奖组件），需对每条未处理 id 补拉动态详情后再识别
 */
async function collectFromTopics(cfg) {
  const found = [];
  const topics = cfg.sources.topics || [];
  const pages = cfg.limits.perTopicPages || 2;
  for (const tid of topics) {
    let offset = "";
    for (let i = 0; i < pages; i++) {
      try {
        const feed = await bili.fetchTopicFeed(tid, offset, 20);
        const cards = (feed.items || []).map((it) => it.dynamic_card_item || it);
        log.info(`话题 ${tid} 第${i + 1}页: ${cards.length} 条`);
        for (const card of cards) {
          const id = card.id_str || card.id || "";
          if (!id) continue;
          // 已处理过（推送/过滤）的跳过
          if (db.isSeen(id)) continue;
          // 2026-09-17 改造：话题卡片直建候选（跳过 detail 接口）。
          // 旧逻辑对每条动态调 detail → 云端 IP 连续请求即 412 → 且 412 时 markSeen 把动态永久跳过
          // （90 天 TTL）→ 话题源归零 + 漏采。直建与传送门源一致，规避 detail 风控。
          // 2026-09-25 修复：排除文章类动态（DYNAMIC_TYPE_ARTICLE，如合集UP的文章动态
          // 混入话题 feed）——文章不是单条抽奖，推送会造成"文不对题"（标题标抽奖雷达、链接却是合集文章）
          const d = bili.extractDynamic(card);
          if (!d.text || !d.text.trim()) continue; // 空文本（预览截断）跳过
          if (d.type === "DYNAMIC_TYPE_ARTICLE") continue; // 文章动态非抽奖，跳过
          found.push(d);
        }
        offset = feed.offset || "";
        if (!feed.has_more || !offset) break;
        await sleep(300 + Math.random() * 700);
      } catch (e) {
        log.warn(`话题 ${tid} 第${i + 1}页失败: ${e.message}`);
        if (/412|101|风控|risk/i.test(e.message)) {
          tg.sendAlert(`B站接口风控/鉴权异常：${e.message}`).catch(() => {});
        }
        break;
      }
    }
  }
  return found;
}

/**
 * 从文章 opus 结构化字段解析"抽奖条目"列表
 * - opus.content 段落数组，text.nodes 中 node_type=4 为链接节点（link.biz_id = 动态ID, link.show_text = 描述）
 * - 每条链接的上下文 = 最近若干段落 + 当前段已累积文本 + show_text
 * - 2026-09-04 新增：文章源直建候选，彻底跳过 detail 接口（规避云端 IP 412 风控）
 */
function parseArticleEntries(opus) {
  const entries = [];
  const buf = [];
  const pushBuf = (t) => {
    // 纯分隔段落（——————/---- 等）不进入上下文缓冲，避免污染条目文本
    if (t && /^[\s\-—–_=~*·.]+$/.test(t)) return;
    buf.push(t);
    if (buf.length > 4) buf.shift(); // 保留最近 4 段（兼容"糯米"格式：[01]UP名/LT开奖时间/奖品 紧邻链接）
  };
  const content = (opus && opus.content && opus.content.paragraphs) || [];
  let lastEntry = null; // 最近一个链接条目，用于回填"抽奖UP的名字和uid"（该段在链接段之后）
  for (const para of content) {
    const nodes = para && para.text && para.text.nodes;
    if (!Array.isArray(nodes)) continue;
    let paraText = "";
    for (const n of nodes) {
      if (n.node_type === 4) {
        // 链接节点：优先 link.biz_id（工具人格式），降级从 link.link/url 提取 t.bilibili.com 或 opus（糯米格式）
        const lnk = n.link || {};
        let id = lnk.biz_id ? String(lnk.biz_id) : "";
        if (!id) {
          const raw = [lnk.link, lnk.url, n.url, n.jump_url, n.whole_text].filter(Boolean).join(" ");
          const m1 = raw.match(/t\.bilibili\.com\/(\d{15,20})/);
          const m2 = raw.match(/opus\/(\d{15,20})/);
          if (m1) id = m1[1];
          else if (m2) id = m2[1];
        }
        const showText = lnk.show_text || "";
        if (!id) { paraText += showText; continue; }
        const ctx = [...buf, paraText, showText]
          .filter(Boolean).join(" ").trim();
        lastEntry = { id, text: ctx, authorName: "", authorMid: "" };
        // 2026-09-25 修复：UP 名回填错位导致推送 authorName 空白。
        // 工具人文章"抽奖UP的名字和uid：【名】、【uid】"段常位于链接段**之前**（已进 buf 污染 ctx），
        // 段落级 upm 只回填 lastEntry（上一个链接）→ 错位。此处从 ctx 直接解析（取最近一组）回填本条目。
        const upmCtxAll = [...ctx.matchAll(/名字和uid[：:]\s*【([^】]+)】[\s、，,]*【(\d+)】/g)];
        if (upmCtxAll.length) {
          const upmLast = upmCtxAll[upmCtxAll.length - 1];
          lastEntry.authorName = upmLast[1].trim();
          lastEntry.authorMid = upmLast[2];
        }
        // 2026-09-25 补充：工具人 9-25 起新文章后半部分不再标"名字和uid"段，
        // 仅链接 show_text 形如"XX的动态"→ 启发式提取 XX 为 UP 名（改善推送区分度）
        if (!lastEntry.authorName) {
          const dm = (showText || "").match(/^([^\s【】]{1,12})的动态$/);
          if (dm) lastEntry.authorName = dm[1].trim();
        }
        // 糯米格式回填 UP 名：上下文含 "[01] ------- UP名" 段
        if (!lastEntry.authorName) {
          const m3 = ctx.match(/\[\d{2}\]\s*[-—–]+\s*([^\s\-—–][^\n]{0,30}?)(?=\s|$)/);
          if (m3) lastEntry.authorName = m3[1].trim();
        }
        entries.push(lastEntry);
        paraText += showText;
      } else if (n.node_type === 1 && n.word && n.word.words) {
        paraText += n.word.words;
      }
    }
    // 回填 UP 名：段落含"抽奖UP的名字和uid：【名】、【uid】"且当前有最近条目
    const upm = paraText.match(/名字和uid[：:]\s*【([^】]+)】[\s、，,]*【(\d+)】/);
    if (upm && lastEntry && !lastEntry.authorName) {
      lastEntry.authorName = upm[1].trim();
      lastEntry.authorMid = upm[2];
    }
    if (paraText.trim()) pushBuf(paraText.trim());
  }
  return entries;
}

/** 文章条目是否抽奖（合集UP 文章高置信：命中奖品信号且非明确非抽奖类型） */
function isArticleRaffleEntry(text) {
  if (!text) return false;
  // 明确非抽奖：公示/名单/招聘/导航链接等（直播预告/上新预告不排除——这类动态常带抽奖，靠下方奖品信号过滤）
  if (/开奖结果|抽奖结果|中奖名单|获奖名单|公示|招聘|报名|节目单|统计|目录页|合集索引|全部版|史上最全|官方抽奖合集】/.test(text)) return false;
  // 奖品信号：送/抽/免费/福利/大奖/奖品/份数/数量词
  return /送|抽|免费|福利|大奖|奖品|抽送|\d+\s*份|随机款|\d+台|\d+套|\d+个|\d+枚|\d+张|\d+元/.test(text);
}

/** 源2 · 合集UP主评论置顶传送门 → 文章 → 抽奖动态（SESSDATA 认证读全文，aid 优先免 view 接口） */
async function collectFromCommentPortal(cfg) {
  const found = [];
  const aids = cfg.sources.collectorAids || [];
  const bvids = cfg.sources.collectorVideos || [];
  const upMids = cfg.sources.collectorUps || [];
  for (let i = 0; i < Math.max(aids.length, bvids.length, upMids.length); i++) {
    let aid = aids[i] || "";
    const bvid = bvids[i] || "";
    const upMid = upMids[i] || "";
    const cvLinks = [];
    try {
      if (!aid && bvid) {
        const v = await bili.getJSON(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
        );
        if (v.code !== 0) {
          log.warn(`视频 ${bvid} 信息失败: ${v.message}`);
          aid = "";
        } else {
          aid = v.data.aid;
        }
      }
      if (!aid && !upMid) continue;
      // ① 评论置顶传送门（依赖 aid）
      if (aid) {
        const c = await bili.getJSON(
          `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`
        );
        const tops = (c.data && c.data.top_replies) || [];
        for (const t of tops) {
          const m = (t.content && t.content.message) || "";
          for (const mm of m.matchAll(/read\/cv(\d+)/g)) cvLinks.push(mm[1]);
        }
        log.info(`视频 ${bvid} 置顶评论传送门: ${cvLinks.length} 篇文章`);
      }
      // ② UP 最新专栏文章列表（x/space/article 已验证可用）：
      //    解决"置顶评论长期不更新 → 新文章/新抽奖漏采 → 推送枯竭"问题
      if (upMid) {
        try {
          const la = await bili.getJSON(
            `https://api.bilibili.com/x/space/article?mid=${upMid}&pn=1&ps=10&sort=publish_time`
          );
          if (la.code === 0 && la.data && Array.isArray(la.data.articles)) {
            const newCvs = la.data.articles.map((a) => String(a.id));
            // 最新文章置顶优先处理（x/space/article 按发布时间降序返回）
            for (const c of newCvs) {
              const idx = cvLinks.indexOf(c);
              if (idx >= 0) cvLinks.splice(idx, 1);
              cvLinks.unshift(c);
            }
            log.info(`UP ${upMid} 最新专栏文章: ${newCvs.length} 篇 (清单共 ${cvLinks.length})`);
          } else {
            log.warn(`UP ${upMid} 文章列表失败: ${la.message || la.code}`);
          }
        } catch (e) {
          log.warn(`UP ${upMid} 文章列表异常: ${e.message}`);
        }
        await sleep(500);
      }
      for (const cv of cvLinks) {
        try {
          const art = await bili.getJSON(
            `https://api.bilibili.com/x/article/view?id=${cv}`
          );
          if (art.code !== 0) {
            log.warn(`文章 cv${cv} 获取失败: ${art.message}`);
            continue;
          }
          // 2026-09-04 改造：从 opus 结构化字段直建候选（含条目上下文文本），
          // 不再逐个 fetch detail —— detail 接口在云端 IP 上连续请求即 412
          const entries = parseArticleEntries(art.data.opus);
          log.info(`文章 cv${cv}: 抽奖动态 ${entries.length} 个`);
          for (const e of entries) {
            if (db.isSeen(e.id)) continue;
            if (!isArticleRaffleEntry(e.text)) continue; // 排除直播/上新/公示等非抽奖条目
            found.push({
              id: e.id,
              type: "DYNAMIC_TYPE_DYNAMIC",
              text: `${e.text} 转发评论关注`, // 补参与类关键词，保证文本规则双命中
              links: [],
              lotteries: [],
              additional: null,
              authorName: e.authorName || "",
              authorMid: e.authorMid || "",
            });
          }
        } catch (e) {
          log.warn(`文章 cv${cv} 请求异常: ${e.message}`);
        }
        await sleep(800); // 文章接口敏感，放慢（直建候选后无需长间隔）
      }
    } catch (e) {
      log.warn(`评论传送门 ${bvid} 失败: ${e.message}`);
    }
  }
  return found;
}

async function collectFromArticleFeed(cfg) {
  // 2026-09-04 停用：源3(article_feed.json 人工清单)已被源2(全自动文章源)完全覆盖，
  // 且源3 需 fetch detail（云端 IP 412 风控重灾区），继续启用只会徒增请求与告警。
  // 文件保留作数据资产，不再参与采集。
  const found = [];
  log.info(`文章清单源已停用（源2 全覆盖，避免 detail 接口 412）`);
  return found;
}

/** 展开汇总帖内的抽奖链接（话题源遇到合集时使用） */
async function expandCandidates(dynamics, cfg) {
  const candidates = [];
  const cap = cfg.limits.maxRaffleDetailFetch || 30;
  let fetched = 0;
  for (const d of dynamics) {
    const det = detect.detectRaffle(d);
    if (!det.isRaffle) continue;
    if (detect.isSummaryPost(d)) {
      if (!d.links.length) {
        try {
          const full = await bili.fetchDynamicDetail(d.id);
          d.links = full.links || d.links;
        } catch (e) { /* 忽略 */ }
      }
      for (const link of d.links) {
        if (fetched >= cap) break;
        const m = link.match(/opus\/(\d+)/);
        if (!m) continue;
        try {
          const sub = await bili.fetchDynamicDetail(m[1]);
          const subDet = detect.detectRaffle(sub);
          if (subDet.isRaffle && !detect.isSummaryPost(sub)) {
            candidates.push({ d: sub, det: subDet });
            fetched++;
            await sleep(200 + Math.random() * 500);
          }
        } catch (e) {
          log.warn(`展开链接 ${link} 失败: ${e.message}`);
        }
      }
    } else {
      candidates.push({ d, det });
    }
  }
  return candidates;
}

/** 过滤：黑名单 / 关键词 / 高风险一票否决 / 粉丝门槛 / 新鲜度 */
async function applyFilters(c, cfg) {
  const f = cfg.filters || {};
  const text = c.d.text || "";
  if ((f.blockedUids || []).includes(c.d.authorMid)) return "uid黑名单";
  if ((f.blockedKeywords || []).some((k) => text.includes(k))) return "关键词黑名单";
  const veto = detect.applyVeto(text, f.vetoRules);
  if (veto) return "一票否决:" + (veto.any || []).join("/");
  // 开奖公示帖拦截（已开奖，非新抽奖；话题源常混入）
  if (/开奖公示|开奖结果公布|中奖名单|开奖名单|本次抽奖已[经于]?/.test(text)) return "开奖公示帖";
  // 粉丝门槛（用户防诈核心诉求）：低于 minFans 的 UP 直接拦截，规避小号诈骗引流
  const minFans = f.minFans || 0;
  if (minFans > 0 && c.d.authorMid) {
    try {
      let fans = fansCache.get(c.d.authorMid);
      if (fans === undefined) {
        fans = await bili.fetchFans(c.d.authorMid);
        fansCache.set(c.d.authorMid, fans);
      }
      if (fans < minFans) return `粉丝不足(${fans}<${minFans})`;
    } catch (e) {
      // 粉丝接口异常时按放行处理（避免误伤真抽奖），记录告警
      log.warn(`粉丝查询失败 mid=${c.d.authorMid}: ${e.message}`);
    }
  }
  // 新鲜度：开奖时间已过 → 过期跳过（种子/详情多为未来开奖）
  const openTime = detect.extractOpenTime(text);
  if (detect.isExpiredByOpenTime(openTime)) return `已开奖(${openTime})`;
  // 新鲜度：动态创建时间超过 N 天（create_time 可用时）
  const maxAge = f.maxAgeDays || 7;
  if (c.d.createTime) {
    const ageDays = (Date.now() / 1000 - c.d.createTime) / 86400;
    if (ageDays > maxAge) return `过期(${Math.round(ageDays)}天)`;
  }
  return null;
}

/** Cookie 登录态前置检查：失效则 TG 告警（同一天最多一次，避免每30分钟刷屏）；不阻断主流程（话题源免登录可跑） */
async function checkBiliLogin() {
  let login;
  try {
    login = await bili.checkLogin();
  } catch (e) {
    log.warn(`登录态检查失败(可忽略): ${e.message}`);
    return;
  }
  if (login.ok) {
    log.info(`B站登录态正常: ${login.uname || "?"}`);
    return;
  }
  const fs = require("fs");
  const path = require("path");
  const alertPath = path.join(__dirname, "..", "data", "last_alert.json");
  const today = new Date().toISOString().slice(0, 10);
  let sentToday = false;
  try {
    const last = JSON.parse(fs.readFileSync(alertPath, "utf8"));
    sentToday = last.type === "cookie" && last.date === today;
  } catch (e) { /* 无记录 */ }
  log.warn(`B站Cookie 失效/未登录 code=${login.code}`);
  if (!sentToday) {
    try {
      await tg.sendAlert(`⚠️ B站Cookie 已失效/未登录(code=${login.code})，请更新 config/.env 的 BILI_COOKIE；当前降级为免登录模式运行`);
      fs.writeFileSync(alertPath, JSON.stringify({ type: "cookie", date: today }));
    } catch (e) {
      log.error(`Cookie 告警发送失败: ${e.message}`);
    }
  }
}

async function main() {
  const cfg = config.config;
  const started = Date.now();
  // 0) 单实例锁：cron 自动轮与手动轮并发时，共享 SQLite 去重会竞态（同 id 重复推送）
  const lockPath = path.join(__dirname, "..", "data", "run.lock");
  try {
    fs.mkdirSync(lockPath);
  } catch (e) {
    log.warn(`已有实例在运行（data/run.lock 存在），本次跳过`);
    process.exit(0);
  }
  const unlock = () => {
    try { fs.rmdirSync(lockPath); } catch (e) { /* 忽略 */ }
  };
  process.on("exit", unlock);
  process.on("SIGINT", () => { unlock(); process.exit(130); });
  process.on("SIGTERM", () => { unlock(); process.exit(143); });
  log.info(`===== BiliRadar 运行开始 =====`);

  // 0) Cookie 登录态前置检查（杜绝静默失败）
  await checkBiliLogin();

  // 1) 采集四源
  const watch = await collectFromWatchlist(cfg);
  log.info(`种子清单: ${watch.length} 条`);
  const topics = await collectFromTopics(cfg);
  log.info(`话题feed: ${topics.length} 条`);
  const portal = await collectFromCommentPortal(cfg);
  log.info(`评论传送门: ${portal.length} 条`);
  const articleFeed = await collectFromArticleFeed(cfg);
  log.info(`文章抽奖清单: ${articleFeed.length} 条`);

  // 2) 识别 + 展开汇总帖
  const candidates = await expandCandidates(
    [...watch, ...topics, ...portal, ...articleFeed],
    cfg
  );
  log.info(`识别出抽奖候选 ${candidates.length} 条`);

  // 3) 去重 + 过滤 + 推送
  // 按「开奖时间升序」排序：临近开奖的先推，避免被 maxPushPerRun 截断在后面
  candidates.sort((a, b) => {
    const aMs = detect.openTimeMs(a.d.text) ?? Number.POSITIVE_INFINITY;
    const bMs = detect.openTimeMs(b.d.text) ?? Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });
  let pushed = 0;
  const skipped = { dup: 0, filtered: 0 };
  const maxPush = cfg.limits.maxPushPerRun || 10;
  for (const c of candidates) {
    if (pushed >= maxPush) break;
    const openMs = detect.openTimeMs(c.d.text);
    // 2026-09-25 修复：markSeen 时机后移 —— 去重只读检查；过滤的标记 seen（永久跳过）；
    // 推送成功后才标记 seen（原实现推送前标记，TG 网络失败会永久丢抽奖）
    if (db.isSeen(c.d.id)) {
      skipped.dup++;
      continue;
    }
    const reason = await applyFilters(c, cfg);
    if (reason) {
      skipped.filtered++;
      db.markSeenIfNew(c.d.id, openMs);
      log.info(`过滤 ${c.d.id}(${c.d.authorName}): ${reason}`);
      continue;
    }
    const payload = detect.buildPushPayload(c.d, c.det);
    try {
      await tg.sendRaffle(payload);
      db.markSeenIfNew(c.d.id, openMs);
      pushed++;
      log.info(`推送 #${pushed}: ${payload.authorName} | 开奖:${payload.openTime || "?"} | ${payload.link}`);
      await sleep(500 + Math.random() * 800);
    } catch (e) {
      log.error(`推送失败: ${e.message}`);
      tg.sendAlert(`Telegram 推送失败：${e.message}`).catch(() => {});
      break; // 不标记 seen → 下轮重试该候选，不丢抽奖
    }
  }

  const cleaned = db.cleanup(90);
  log.info(
    `本次运行：种子${watch.length} 话题${topics.length} 传送门${portal.length} 文章清单${articleFeed.length} | 候选 ${candidates.length} | 推送 ${pushed} | 去重 ${skipped.dup} | 过滤 ${skipped.filtered} | TTL ${cleaned} | 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  log.info(`===== BiliRadar 运行结束 =====`);
}

main().catch((e) => {
  log.error(`主流程异常: ${e.stack || e.message}`);
  process.exit(1);
});
