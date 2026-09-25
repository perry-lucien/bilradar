/**
 * 一次性调试：找话题源候选里重复 id 的对象来源与字段差异
 * 用法：node scripts/debug_dup.js
 */
const path = require("path");
const config = require(path.join(__dirname, "..", "src", "config"));
const bili = require(path.join(__dirname, "..", "src", "bili"));

async function collectTopic(topicId, cfg) {
  // 复刻 collectFromTopics 的翻页逻辑（perTopicPages=2）
  const pages = cfg.limits.perTopicPages || 2;
  const out = [];
  let offset = "";
  for (let p = 0; p < pages; p++) {
    const list = await bili.fetchTopicFeed(topicId, offset, 20);
    const items = (list && list.items) || [];
    if (!items.length) break;
    for (const it of items) {
      const dc = it.dynamic_card_item || {};
      const d = bili.extractDynamic(dc);
      if (!d.id) continue;
      out.push(d);
    }
    if (!list.has_more) break;
    offset = list.offset || "";
  }
  return out;
}

async function main() {
  const cfg = config.config;
  const tA = await collectTopic(cfg.sources.topics[0], cfg);
  const tB = await collectTopic(cfg.sources.topics[1], cfg);
  console.log("12031 条数:", tA.length, "| 1094880 条数:", tB.length);
  const idsA = new Set(tA.map((t) => t.id));
  const idsB = new Set(tB.map((t) => t.id));
  const overlap = [...idsA].filter((x) => idsB.has(x));
  console.log("重叠:", overlap.length);
  if (overlap.length) console.log("重叠示例:", overlap.slice(0, 8).join(","));
  // 重复 id 详情（同话题内重复？）
  const seen = {};
  for (const t of [...tA, ...tB]) {
    if (!seen[t.id]) seen[t.id] = [];
    seen[t.id].push({ author: t.authorName, text: (t.text || "").slice(0, 50) });
  }
  for (const [id, arr] of Object.entries(seen)) {
    if (arr.length > 1) {
      console.log("多源重复:", id, "x", arr.length, "|", JSON.stringify(arr[0].author), "|", JSON.stringify(arr[1].author));
    }
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
