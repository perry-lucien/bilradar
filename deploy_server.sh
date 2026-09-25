#!/bin/bash
# BiliRadar 服务器部署脚本（在服务器 ~/bilradar 下运行）
set -e
cd ~/bilradar

echo "== 1. 固定 better-sqlite3 v11（有 Node20 linux 预编译） =="
sed -i 's/"better-sqlite3": "[^"]*"/"better-sqlite3": "^11.10.0"/' package.json
grep '"better-sqlite3"' package.json

echo "== 2. 调整 .env（TG 直连可用，去掉本地代理） =="
sed -i 's|^HTTP_PROXY=.*|HTTP_PROXY=|' config/.env || true
grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|BILI_COOKIE|HTTP_PROXY)=' config/.env | sed 's/\(TOKEN=\).*/\1<已隐藏>/' | sed 's/\(SESSDATA=\).\{8\}.*/\1<已隐藏>/'

echo "== 3. npm install =="
npm install 2>&1 | tail -4

echo "== 4. 验证依赖加载 =="
node -e 'const b=require("better-sqlite3"); console.log("better_sqlite3 node 文件存在:", require("fs").existsSync("node_modules/better-sqlite3/build/Release/better_sqlite3.node")); console.log("better-sqlite3 加载 OK");'

echo "== 5. 快速连通性测试（bili + tg） =="
node -e '
const bili=require("./src/bili");
const tg=require("./src/telegram");
(async()=>{
  try{
    const v=await bili.getJSON("https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=1242177612289146913&timezone_offset=-480&features=itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard");
    console.log("B站polymer详情:", v.code===0?"OK code0":"code "+v.code);
  }catch(e){console.log("B站详情失败:", e.message);}
  try{
    const a=await bili.getJSON("https://api.bilibili.com/x/article/view?id=52770586");
    console.log("B站文章(带Cookie):", a.code===0?("OK 长度"+a.data.content.length):"code "+a.code);
  }catch(e){console.log("B站文章失败:", e.message);}
  try{
    const r=await tg.api("getMe",{});
    console.log("Telegram getMe OK, bot:", r.username);
  }catch(e){console.log("Telegram失败:", e.message);}
})();
'
echo "== 部署准备完成 =="
