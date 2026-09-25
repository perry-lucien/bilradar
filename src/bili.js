/**
 * BiliRadar B站 API 客户端
 * 全部使用免登录可用的接口（S0 已验证）：
 *  - 话题 feed: /x/polymer/web-dynamic/v1/feed/topic
 *  - 动态详情: /x/polymer/web-dynamic/v1/detail
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FEATURES =
  "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard";
const log = require("./logger");
const config = require("./config");

/** 附加 B站 Cookie（若有）——认证请求不易被风控 */
function cookieHeaders() {
  const c = config.bili && config.bili.cookie;
  return c ? { Cookie: c } : {};
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      ...cookieHeaders(),
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`非JSON响应(${res.status}) ${url} -> ${text.slice(0, 60)}`);
  }
  return json;
}

/**
 * 抓取话题动态列表（源1·话题矩阵，2026-09 验证）
 * 关键：sort_by=3 才是"最新"（2=热门/3=最新，配置来自接口 topic_sort_by_conf）；
 * 带 Cookie 在云机房 IP 上可直连（免 WAF）；返回 topic_card_list.items[].dynamic_card_item
 */
async function fetchTopicFeed(topicId, offset = "", pageSize = 20) {
  const url =
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/topic` +
    `?topic_id=${topicId}&sort_by=3&offset=${encodeURIComponent(offset)}` +
    `&page_size=${pageSize}&features=${FEATURES}&web_location=333.1035`;
  const json = await getJSON(url);
  if (json.code !== 0)
    throw new Error(`feed/topic code=${json.code} msg=${json.message}`);
  return json.data.topic_card_list;
}

/** 抓取单条动态详情 */
async function fetchDynamicDetail(id) {
  const url =
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail` +
    `?id=${id}&timezone_offset=-480&features=${FEATURES}`;
  const json = await getJSON(url);
  if (json.code !== 0)
    throw new Error(`detail code=${json.code} msg=${json.message}`);
  const item = json.data.item || {};
  return extractDynamic({
    id_str: item.id_str || item.id || String(id),
    type: item.type || "",
    modules: item.modules || {},
    basic: item.basic || {},
  });
}

/** 查询UP主粉丝数（x/relation/stat 轻量接口，云端已验证可用；用于粉丝门槛过滤） */
async function fetchFans(mid) {
  const json = await getJSON(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`);
  if (json.code !== 0)
    throw new Error(`relation/stat code=${json.code} msg=${json.message}`);
  return json.data?.follower ?? 0;
}

/** 检查当前 Cookie 登录态（nav 接口；失效/未登录时 Alert，杜绝静默失败） */
async function checkLogin() {
  const json = await getJSON("https://api.bilibili.com/x/web-interface/nav");
  if (json.code === 0 && json.data?.isLogin) {
    return { ok: true, uname: json.data.uname || "" };
  }
  return { ok: false, code: json.code, uname: json.data?.uname || "" };
}

/** 扫描富文本节点中的官方互动抽奖（rid） */
function extractRichTextLotteries(richNodes) {
  if (!Array.isArray(richNodes)) return [];
  return richNodes
    .filter((n) => n && n.type === "RICH_TEXT_NODE_TYPE_LOTTERY")
    .map((n) => ({ rid: n.rid || n.rid_str || "", text: n.orig_text || n.text || "" }));
}

/** 扫描富文本节点中的链接（抽奖动态链接等） */
function extractRichTextLinks(richNodes) {
  if (!Array.isArray(richNodes)) return [];
  const out = [];
  for (const n of richNodes) {
    if (!n) continue;
    const candidates = [
      n.jump_url,
      n.url,
      n.uri,
      n.prefix,
      n.whole_text,
    ].filter(Boolean);
    for (const c of candidates) {
      if (typeof c === "string" && c.includes("opus")) out.push(c);
    }
  }
  return out;
}

/** 从一条动态卡片提取结构化信息 */
function extractDynamic(dc) {
  const modules = dc.modules || {};
  const author = modules.module_author || {};
  const dyn = modules.module_dynamic || {};
  const stat = modules.module_stat || {};
  const desc = dyn.desc || {};
  const additional = dyn.additional || null;

  let majorText = "";
  let lotteries = [];
  let richNodes = [];
  const major = dyn.major || {};
  if (major.archive) {
    majorText = [major.archive.title, major.archive.desc].filter(Boolean).join(" ");
  } else if (major.draw) {
    majorText = major.draw.title || "";
  } else if (major.article) {
    majorText = (major.article.title || "") + " " + (major.article.desc || "");
  } else if (major.opus) {
    majorText = (major.opus.title || "") + " " + (major.opus.summary?.text || "");
    richNodes = major.opus.summary?.rich_text_nodes || [];
    lotteries = extractRichTextLotteries(richNodes);
  } else if (major.common) {
    majorText = major.common.title || "";
  }
  if (!lotteries.length && desc.rich_text_nodes) {
    richNodes = desc.rich_text_nodes;
    lotteries = extractRichTextLotteries(richNodes);
  }

  const text = [desc.text, majorText].filter(Boolean).join("\n").trim();
  const authorMid = author.mid || author.mid_str || "";
  return {
    id: dc.id_str || "",
    type: dc.type || "",
    authorName: author.name || "",
    authorMid: String(authorMid),
    text,
    commentCount: stat.comment?.count ?? 0,
    forwardCount: stat.forward?.count ?? 0,
    likeCount: stat.like?.count ?? 0,
    additional,
    lotteries, // 官方互动抽奖 rid 列表
    links: extractRichTextLinks(richNodes), // 富文本内链接（用于合集文章解析）
    createTime: dyn?.create_time || 0,
  };
}

module.exports = {
  getJSON,
  fetchTopicFeed,
  fetchDynamicDetail,
  fetchFans,
  checkLogin,
  extractDynamic,
  extractRichTextLotteries,
};
