# BiliRadar 云服务器部署文档

> 记录 2026-09-01 甲骨文云（Oracle Cloud）部署实况与运维要点。

## 1. 服务器信息

| 项目 | 值 |
|---|---|
| 地址 | `user@YOUR_SERVER_IP` |
| 密钥 | `~/.ssh/your-key.key`（本地 PowerShell 连接） |
| 系统 | Ubuntu 24.04 LTS（Oracle 内核 6.17，x86_64，海德拉巴机房） |
| 内存 | 954 MiB 总量 / 可用约 500+ MiB（雷达峰值仅 ~100MB，余量充足） |
| 磁盘 | 47.39 GB，已用 6.3% |
| Node | v20.20.2（NodeSource 安装，`/usr/bin/node`） |
| 部署目录 | `/home/ubuntu/bilradar` |

连接命令：
```powershell
ssh -i "~/.ssh/your-key.key" user@YOUR_SERVER_IP
```

## 2. 与本地环境的差异（重要）

| 项 | 本地（Windows 沙箱） | 云（Ubuntu） |
|---|---|---|
| Telegram 代理 | 必须走本地 `127.0.0.1:7897`（Clash） | **直连可用**（海德拉巴 IP 访问 api.telegram.org 0.56s），`.env` 中 `HTTP_PROXY=` 留空 |
| better-sqlite3 | v11.10.0（本地同步为 v11） | **必须用 v11**（v12 无 Node20 Linux 预编译，会走 node-gyp 编译，1GB 小机易挂） |
| B站 IP 风控 | 沙箱 IP 已严重 412 | 云 IP 全新，当前全接口 code 0，正常 |
| 调度 | 本地 agent 定时任务（已暂停防双跑） | 服务器 crontab（见下） |

## 3. 定时任务（crontab）

```cron
*/30 * * * * cd /home/ubuntu/bilradar && /usr/bin/node src/index.js >> /dev/null 2>&1
5 * * * * /home/ubuntu/bilradar/watchdog.sh
```

- 每 30 分钟巡检一次；日志双写追加到 `runtime.log`
- `watchdog.sh`：云端心跳监控（2026-09-03 上线，替代本地「每日健康检查」任务）——runtime.log 超过 90 分钟（3 个 cron 周期）无更新即视为 cron 停止/服务器异常，通过 TG 告警（2 小时去重防刷屏）；不依赖本地电脑，7×24 自愈监控
- 查看：`crontab -l`；修改后 `crontab -e`

## 4. 重新部署 / 更新代码

```powershell
# 本地打部署包（排除 node_modules / 运行时文件）
cd "D:\DouBao_Program\抽奖推送"
tar -czf bilradar-deploy.tar.gz --exclude=node_modules --exclude=runtime.log --exclude=data/bilradar.db-wal --exclude=data/bilradar.db-shm .

# 上传解压（会覆盖 ~/bilradar）
scp -i "~/.ssh/your-key.key" bilradar-deploy.tar.gz user@YOUR_SERVER_IP:~/
ssh -i "~/.ssh/your-key.key" user@YOUR_SERVER_IP "tar -xzf ~/bilradar-deploy.tar.gz -C ~/bilradar && cd ~/bilradar && npm install"
```

> 只更新单个文件时可直接 scp 对应文件（如 `src/index.js`），无需重打整包。

## 5. 手动运行 / 查看

```bash
cd ~/bilradar && node src/index.js        # 手动跑一轮
tail -50 ~/bilradar/runtime.log           # 看运行日志
sqlite3 ~/bilradar/data/bilradar.db "select count(*) from seen_dynamics;"   # 看去重库条数
```

## 6. 运维注意

- **敏感凭证**：`config/.env` 含 TG token / chat_id / B站 SESSDATA，勿外泄、勿入库。
- **Cookie 过期**：SESSDATA 会过期，失效后文章接口回到 -509；接口报鉴权错误时 Telegram 会收到 `[Alert]` 告警，届时更新 `.env` 的 `BILI_COOKIE`。
- **内存**：1GB 实例足够，但避免同时跑重编译任务；npm install 时不要在高峰并发。
- **TTL**：去重库按"开奖时间"清理（已开奖即删），无开奖时间 90 天兜底；不会在有效期内误删导致二次推送。
