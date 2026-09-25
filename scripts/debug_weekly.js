/** 一次性探测：小助理(uid=885439)最新投稿 → 周报简介抽奖清单 */
const path = require("path");
const wbi = require(path.join(__dirname, "..", "src", "wbi"));
const config = require(path.join(__dirname, "..", "src", "config"));

async function main() {
  const uid = "885439";
  // 1) wbi 投稿列表（最新5条）
  const j = await wbi.signedGetJSON(
    "https://api.bilibili.com/x/space/wbi/arc/search",
    { mid: uid, ps: 5, pn: 1, order: "pubdate" },
    { Referer: `https://space.bilibili.com/${uid}/video` }
  );
  if (j.code !== 0) { console.log("arc/search code:", j.code, j.message); return; }
  const vlist = (j.data && j.data.list && j.data.list.vlist) || [];
  console.log("=== 最新投稿 ===");
  for (const v of vlist.slice(0, 5)) {
    console.log("-", v.bvid, "|", v.title.slice(0, 45), "|", new Date(v.created * 1000).toISOString().slice(0, 10));
  }
  // 2) 最新周报（标题含"抽奖周报"的）desc
  const latest = vlist.find((v) => v.title.includes("抽奖周报")) || vlist[0];
  console.log("\n=== 最新周报:", latest.bvid, latest.title, "===");
  const cookie = config.bili && config.bili.cookie;
  const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${latest.bvid}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36", Referer: "https://www.bilibili.com/", ...(cookie ? { Cookie: cookie } : {}) },
  });
  const v = await res.json();
  if (v.code !== 0) { console.log("view code:", v.code, v.message); return; }
  const desc = v.data.desc || "";
  console.log("desc 长度:", desc.length);
  console.log(desc.slice(0, 1200));
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
