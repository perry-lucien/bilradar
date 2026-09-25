#!/bin/bash
# BiliRadar 每日健康检查脚本（部署在云端 ~/bilradar/health_check.sh）
# 用法：bash ~/bilradar/health_check.sh
cd ~/bilradar || exit 1
cutoff=$(date -d '24 hours ago' '+%Y-%m-%d %H:%M:%S')
echo "CUTOFF=$cutoff"
runs=$(awk -v c="$cutoff" '$0 >= c && /运行开始/ {n++} END{print n+0}' runtime.log)
errs=$(awk -v c="$cutoff" '$0 >= c && /ERROR/ {n++} END{print n+0}' runtime.log)
pushed=$(awk -v c="$cutoff" '$0 >= c && /推送 #/ {n++} END{print n+0}' runtime.log)
echo "RUNS=$runs"
echo "ERRORS=$errs"
echo "PUSHED=$pushed"
echo "--- 最近推送 ---"
grep '推送 #' runtime.log | tail -4
echo "--- 最近ERROR ---"
grep ERROR runtime.log | tail -4
echo "--- 最近3行 ---"
tail -3 runtime.log
