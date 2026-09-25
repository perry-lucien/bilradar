/**
 * BiliRadar 运行日志（runtime.log）
 * 与产品日志（LOG.md）分离：这里记录程序运行的请求 / 报错 / 关键事件
 */
const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(__dirname, "..", "runtime.log");

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function write(line) {
  try {
    fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
  } catch (e) {
    /* 日志失败不阻断主流程 */
  }
}

function info(msg) {
  const line = `[${ts()}] [INFO] ${msg}`;
  write(line);
  console.log(line);
}

function warn(msg) {
  const line = `[${ts()}] [WARN] ${msg}`;
  write(line);
  console.warn(line);
}

function error(msg) {
  const line = `[${ts()}] [ERROR] ${msg}`;
  write(line);
  console.error(line);
}

module.exports = { info, warn, error, ts };
