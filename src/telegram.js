/**
 * BiliRadar Telegram 推送
 * - 需走本地代理（国内直连 api.telegram.org 不通）
 * - 抽奖推送：结构化消息 + 内联「直达B站」URL 按钮
 * - 系统告警：Cookie 失效 / 鉴权失败 → [Alert]
 */
const { ProxyAgent } = require("undici");
const config = require("./config");
const log = require("./logger");
const detect = require("./detect");

const API_BASE = "https://api.telegram.org";
const agent = config.telegram.proxy ? new ProxyAgent(config.telegram.proxy) : null;

/** 调用 Bot API（统一走代理） */
async function api(method, payload) {
  const url = `${API_BASE}/bot${config.telegram.token}/${method}`;
  const opts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
  if (agent) opts.dispatcher = agent;
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!json.ok) throw new Error(`TG ${method}: ${json.description || "unknown"}`);
  return json.result;
}

/** 组装抽奖消息文本：结构化展示关键信息（奖品/参与/开奖），原文完整保留兜底 */
function formatRaffleMessage(p) {
  const prize = detect.extractPrize(p.text);
  const entry = detect.extractEntry(p.text);
  const lines = [];
  lines.push(`🎁 抽奖雷达 | ${p.authorName || "未知UP"}`);
  if (prize) lines.push(`🏆 奖品：${prize}`);
  if (p.openTime) lines.push(`⏰ 开奖：${p.openTime}`);
  if (entry) lines.push(`📋 参与：${entry}`);
  lines.push(`🧷 UP：${p.authorName} (${p.authorMid})`);
  lines.push(`🔗 ${p.link}`);
  if (p.source === "official") lines.push(`✅ 官方互动抽奖${p.lotteries?.length ? " (rid=" + p.lotteries.map((l) => l.rid).join(",") + ")" : ""}`);
  const raw = p.text || "";
  lines.push(`📄 原文：${raw.slice(0, 250)}${raw.length > 250 ? "…" : ""}`);
  return lines.join("\n");
}

/** 推送一条抽奖 */
async function sendRaffle(p) {
  const text = formatRaffleMessage(p);
  const replyMarkup = {
    inline_keyboard: [[{ text: "🚀 直达B站", url: p.link }]],
  };
  return api("sendMessage", {
    chat_id: config.telegram.chatId,
    text,
    reply_markup: replyMarkup,
  });
}

/** 推送系统告警 */
async function sendAlert(msg) {
  const text = `⚠️ [Alert] BiliRadar\n${msg}`;
  return api("sendMessage", { chat_id: config.telegram.chatId, text });
}

module.exports = { sendRaffle, sendAlert, api };
