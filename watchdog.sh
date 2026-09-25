#!/bin/bash
# BiliRadar Watchdog —— 云端 7×24 心跳监控（替代本地每日健康检查）
# 作用：检查主流程 runtime.log 是否在 MAX_AGE 秒内有更新（cron 每 30 分钟一轮）
#       超时 = cron 可能停止 / 服务器异常 → TG 告警（2 小时去重，避免刷屏）
# 由云端 crontab 每小时触发：5 * * * * /home/ubuntu/bilradar/watchdog.sh
# 不依赖本地电脑，云端自愈监控。

LOG=/home/ubuntu/bilradar/runtime.log
MAX_AGE=5400                    # 90 分钟（3 个 cron 周期）
ALERT_FILE=/home/ubuntu/bilradar/data/watchdog_last_alert
ALERT_GAP=7200                  # 去重间隔 2 小时
ENV_FILE=/home/ubuntu/bilradar/config/.env

NOW=$(date +%s)
LAST=$(stat -c %Y "$LOG" 2>/dev/null || echo 0)
AGE=$((NOW - LAST))

if [ "$AGE" -gt "$MAX_AGE" ]; then
  LAST_ALERT=$(cat "$ALERT_FILE" 2>/dev/null || echo 0)
  if [ $((NOW - LAST_ALERT)) -gt "$ALERT_GAP" ]; then
    TG_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
    TG_CHAT=$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
      MSG="⚠️ BiliRadar 告警：runtime.log 已 ${AGE}s 未更新（>90min，超3轮），cron 可能停止或服务器异常！请检查服务器与进程。"
      curl -s --max-time 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -d "chat_id=${TG_CHAT}" -d "text=${MSG}" >/dev/null 2>&1
      echo "$NOW" > "$ALERT_FILE"
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT sent (age=${AGE}s)" >> /home/ubuntu/bilradar/data/watchdog.log
    fi
  fi
fi
