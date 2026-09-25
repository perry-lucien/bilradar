/**
 * BiliRadar SQLite 存储：按 dynamic_id 去重 + TTL 清理（防表膨胀）
 */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "bilradar.db");
let db = null;

function init() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_dynamics (
      dynamic_id   TEXT PRIMARY KEY,
      first_seen_at INTEGER NOT NULL,
      open_time    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_dynamics(first_seen_at);
  `);
  // 旧库迁移：补 open_time 列（已存在则忽略），再建索引
  try {
    db.exec("ALTER TABLE seen_dynamics ADD COLUMN open_time INTEGER");
  } catch (e) {
    /* 列已存在 */
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_open_time ON seen_dynamics(open_time)");
  return db;
}

/** 未见过则记录并返回 true（即"这条该推送"）；已见过返回 false
 *  原子实现：INSERT OR IGNORE + changes 判断，杜绝「先 SELECT 再 INSERT」的并发竞态
 *  （cron 与手动轮并发时，同 id 可能被两轮各判一次"新"而重复推送） */
function markSeenIfNew(dynamicId, openTimeMs) {
  const d = init();
  const now = Math.floor(Date.now() / 1000);
  const info = d
    .prepare(
      "INSERT OR IGNORE INTO seen_dynamics (dynamic_id, first_seen_at, open_time) VALUES (?, ?, ?)"
    )
    .run(String(dynamicId), now, openTimeMs || null);
  return info.changes > 0;
}

/** 是否已见过（只读查询，不写入） */
function isSeen(dynamicId) {
  const d = init();
  const row = d
    .prepare("SELECT 1 FROM seen_dynamics WHERE dynamic_id = ?")
    .get(String(dynamicId));
  return !!row;
}

/**
 * TTL 清理（按开奖时间，智能防二次推送）：
 * - 有开奖时间的：开奖已过**且**首次记录超过 7 天 → 删。
 *   （开奖后 7 天内保留，避免已开奖 id 每轮被源重复带回、反复拉详情/过滤造成日志噪音与 412 压力）
 * - 无开奖时间的：按兜底天数（默认 90 天）清理，防表无限膨胀
 */
function cleanup(fallbackDays = 90) {
  const d = init();
  const nowMs = Date.now();
  const closedKeepSec = Math.floor(nowMs / 1000) - 7 * 86400;
  const fallbackSec = Math.floor(nowMs / 1000) - fallbackDays * 86400;
  const info = d
    .prepare(
      "DELETE FROM seen_dynamics WHERE " +
        "(open_time IS NOT NULL AND open_time < ? AND first_seen_at < ?) OR " +
        "(open_time IS NULL AND first_seen_at < ?)"
    )
    .run(nowMs, closedKeepSec, fallbackSec);
  return info.changes;
}

module.exports = { init, markSeenIfNew, isSeen, cleanup };
