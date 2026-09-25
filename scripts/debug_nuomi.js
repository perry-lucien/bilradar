/** 打印糯米文章第一个 node_type=4 节点完整结构 */
const path = require("path");
const config = require(path.join(__dirname, "..", "src", "config"));

async function main() {
  const cookie = config.bili && config.bili.cookie;
  const res = await fetch("https://api.bilibili.com/x/article/view?id=53055772", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36", Referer: "https://www.bilibili.com/", ...(cookie ? { Cookie: cookie } : {}) },
  });
  const j = await res.json();
  const paras = (j.data.opus.content && j.data.opus.content.paragraphs) || [];
  let shown = 0;
  for (const p of paras) {
    const nodes = p && p.text && p.text.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const n of nodes) {
      if (n.node_type === 4) {
        console.log("=== 链接节点完整JSON ===");
        console.log(JSON.stringify(n).slice(0, 1200));
        shown++;
        if (shown >= 2) return;
      }
    }
  }
  if (!shown) console.log("未找到 node_type=4 节点");
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
