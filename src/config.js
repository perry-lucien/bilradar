/**
 * BiliRadar 配置加载
 * 敏感项从 config/.env 读取（dotenv），非敏感项从 config/config.json 读取
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", "config", ".env"),
});
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("[config] config.json 读取失败:", e.message);
    return { sources: {}, filters: {}, limits: {} };
  }
}

module.exports = {
  config: loadConfig(),
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    proxy: process.env.HTTP_PROXY || process.env.http_proxy || "",
  },
  bili: {
    cookie: process.env.BILI_COOKIE || "",
  },
};
