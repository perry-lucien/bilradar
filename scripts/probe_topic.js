// 探测 B站话题 id 获取途径 + Apple 相关话题
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
(async () => {
  for (const name of ['iPhone', '苹果', 'iPhoneDuo', '数码']) {
    try {
      const r = await fetch('https://api.bilibili.com/x/web-interface/topic/details?topic_name=' + encodeURIComponent(name), {
        headers: { 'User-Agent': ua, Referer: 'https://www.bilibili.com/' }
      });
      const j = await r.json();
      console.log('topic/details', name, '=>', j.code, j.message, j.data ? JSON.stringify(j.data).slice(0, 200) : '');
    } catch (e) {
      console.log('topic/details', name, 'ERR', e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  try {
    const r = await fetch('https://t.bilibili.com/topic/name/iPhone', { headers: { 'User-Agent': ua, Referer: 'https://www.bilibili.com/' } });
    const t = await r.text();
    const m = t.match(/topic_id["'=]+\s*(\d+)/) || t.match(/topic\/(\d+)/);
    console.log('topic页 iPhone:', r.status, m ? m[0] : 'no-topic-id', t.slice(0, 100).replace(/\n/g, ' '));
  } catch (e) {
    console.log('topic页 ERR', e.message);
  }
})();
