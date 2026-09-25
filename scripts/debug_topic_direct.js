/** 一次性验证：话题 feed 直建候选（extractDynamic）质量 */
const path = require("path");
const config = require(path.join(__dirname, "..", "src", "config"));
const bili = require(path.join(__dirname, "..", "src", "bili"));
const detect = require(path.join(__dirname, "..", "src", "detect"));

async function main() {
  const cfg = config.config;
  for (const tid of cfg.sources.topics) {
    const list = await bili.fetchTopicFeed(tid, "", 20);
    const cards = (list.items || []).map((it) => it.dynamic_card_item || it);
    let withText = 0, raffle = 0, withAuthor = 0;
    const samples = [];
    for (const card of cards) {
      const d = bili.extractDynamic(card);
      if (d.text && d.text.trim()) withText++;
      else samples.push({ id: d.id, author: d.authorName, type: d.type, hasDescText: !!(card.modules?.module_dynamic?.desc?.text) });
      if (d.authorName) withAuthor++;
      if (detect.detectRaffle(d).isRaffle) raffle++;
    }
    console.log(`话题${tid}: 卡片${cards.length} | 有文本${withText} | 有作者${withAuthor} | 识别为抽奖${raffle}`);
    if (samples.length) {
      console.log("无文本示例:", JSON.stringify(samples.slice(0, 3)));
      // 看一条无文本的原始结构
      const s0 = cards.find((c) => !bili.extractDynamic(c).text);
      if (s0) {
        const m = s0.modules || {};
        console.log("结构keys:", Object.keys(m));
        console.log("module_dynamic keys:", Object.keys(m.module_dynamic || {}));
        console.log("desc keys:", Object.keys(m.module_dynamic?.desc || {}));
        console.log("major keys:", Object.keys(m.module_dynamic?.major || {}));
      }
    }
  }
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
