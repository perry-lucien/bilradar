// 检查合集UP 最新文章里是否有 Apple 相关抽奖条目
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'index.js'), 'utf8');
const parseArticleEntries = eval('(' + src.match(/function parseArticleEntries[\s\S]*?\n\}/)[0] + ')');
const APPLE_RE = /iPhone|苹果|Apple|MacBook|iPad|AirPods|Watch|折叠屏|影视飓风/i;
(async () => {
  // 最新文章列表
  const r = await fetch('https://api.bilibili.com/x/space/article?mid=100680137&pn=1&ps=5&sort=publish_time', {
    headers: { 'User-Agent': ua, Referer: 'https://www.bilibili.com/', Cookie: '' }
  });
  const j = await r.json();
  if (j.code !== 0) { console.log('文章列表失败', j.code, j.message); return; }
  const arts = j.data.articles || [];
  console.log('最新文章:', arts.map(a => a.id + ' ' + a.title.slice(0, 30)).join('\n  '));
  for (const a of arts.slice(0, 3)) {
    const r2 = await fetch('https://api.bilibili.com/x/article/view?id=' + a.id, {
      headers: { 'User-Agent': ua, Referer: 'https://www.bilibili.com/' }
    });
    const j2 = await r2.json();
    if (j2.code !== 0 || !j2.data || !j2.data.opus) { console.log('文章', a.id, '读取失败', j2.code); continue; }
    const entries = parseArticleEntries(j2.data.opus);
    const apple = entries.filter(e => APPLE_RE.test(e.text));
    console.log(`\n[${a.id}] ${a.title.slice(0, 25)} 条目${entries.length} 个, Apple相关 ${apple.length} 个`);
    for (const e of apple.slice(0, 5)) {
      console.log('  🍎', e.id, '|', e.text.slice(0, 70).replace(/\n/g, ' '));
    }
    await new Promise(r => setTimeout(r, 800));
  }
})();
