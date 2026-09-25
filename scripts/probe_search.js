// 试 B站搜索接口（video/dynamic/topic 类型）是否可用
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
(async () => {
  const kw = encodeURIComponent('iPhone Duo 抽奖');
  // 视频搜索
  for (const [name, url] of [
    ['video搜索', `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${kw}&page=1`],
    ['topic搜索', `https://api.bilibili.com/x/web-interface/search/type?search_type=topic&keyword=${encodeURIComponent('iPhone')}&page=1`],
    ['dynamic搜索', `https://api.bilibili.com/x/web-interface/search/type?search_type=dynamic&keyword=${kw}&page=1`],
  ]) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua, Referer: 'https://search.bilibili.com/' } });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch (e) { console.log(name, '非JSON(HTML/风控):', t.slice(0, 60).replace(/\n/g, ' ')); continue; }
      if (j.code === 0 && j.data && j.data.result) {
        console.log(name, 'OK 结果数:', Array.isArray(j.data.result) ? j.data.result.length : 'obj');
        const arr = Array.isArray(j.data.result) ? j.data.result : [j.data.result];
        for (const it of arr.slice(0, 3)) console.log('   -', (it.title || it.keyword || '').replace(/<[^>]+>/g, '').slice(0, 50), '|', it.url || it.link || '');
      } else {
        console.log(name, 'code:', j.code, j.message);
      }
    } catch (e) { console.log(name, 'ERR', e.message); }
    await new Promise(r => setTimeout(r, 800));
  }
})();
