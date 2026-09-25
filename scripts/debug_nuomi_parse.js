/** 验证 parseArticleEntries 对糯米文章的提取（含UP名回填），复刻 index.js 逻辑 */
const path = require("path");
const config = require(path.join(__dirname, "..", "src", "config"));

function parseArticleEntries(opus) {
  const entries = [];
  const buf = [];
  const pushBuf = (t) => {
    if (t && /^[\s\-—–_=~*·.]+$/.test(t)) return;
    buf.push(t);
    if (buf.length > 3) buf.shift();
  };
  const content = (opus && opus.content && opus.content.paragraphs) || [];
  let lastEntry = null;
  for (const para of content) {
    const nodes = para && para.text && para.text.nodes;
    if (!Array.isArray(nodes)) continue;
    let paraText = "";
    for (const n of nodes) {
      if (n.node_type === 4) {
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
        const ctx = [...buf, paraText, showText].filter(Boolean).join(" ").trim();
        lastEntry = { id, text: ctx, authorName: "", authorMid: "" };
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
    const upm = paraText.match(/名字和uid[：:]\s*【([^】]+)】[\s、，,]*【(\d+)】/);
    if (upm && lastEntry && !lastEntry.authorName) {
      lastEntry.authorName = upm[1].trim();
      lastEntry.authorMid = upm[2];
    }
    if (paraText.trim()) pushBuf(paraText.trim());
  }
  return entries;
}

async function main() {
  const cookie = config.bili && config.bili.cookie;
  const res = await fetch("https://api.bilibili.com/x/article/view?id=53055772", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36", Referer: "https://www.bilibili.com/", ...(cookie ? { Cookie: cookie } : {}) },
  });
  const j = await res.json();
  const entries = parseArticleEntries(j.data.opus);
  console.log("条目总数:", entries.length);
  entries.slice(0, 6).forEach((e) => {
    console.log("-", e.id, "| UP:", e.authorName || "(空)", "|", e.text.slice(0, 70));
  });
  // 含 Apple 关键词的条目
  const apple = entries.filter((e) => /iPhone|苹果|折叠|MacBook|iPad|AirPods/i.test(e.text));
  console.log("\n含Apple关键词条目:", apple.length);
  apple.slice(0, 5).forEach((e) => console.log("  ⭐", e.id, "| UP:", e.authorName || "(空)", "|", e.text.slice(0, 80)));
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
