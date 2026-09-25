# BiliRadar · B站抽奖雷达

> 只读监控 B 站抽奖信息，按门槛过滤后把「奖品 / 参与要求 / 开奖时间 / 链接」推送到 Telegram。

个人自用工具（仅供学习参考）。通过话题 feed 与抽奖合集 UP 主文章等公开信息源自动发现并推送抽奖动态；**只读不互动，不自动参与抽奖**。

## 功能

- **多源采集**：话题 feed + 合集 UP 主文章（评论置顶传送门 / 最新专栏列表）
- **抽奖识别**：官方互动抽奖（rid）结构化识别优先，无组件时降级文本规则引擎
- **多重过滤**：UP 主 UID 黑名单 / 关键词黑名单 / 高风险一票否决 / 开奖公示帖拦截 / 新鲜度
- **结构化推送**：奖品 / 参与要求 / 开奖时间 + 直达原动态链接按钮
- **系统告警**：Cookie 失效、接口风控、推送失败 → Telegram Alert，杜绝静默失败
- **去重与清理**：SQLite 按 dynamic_id 去重 + 开奖时间 TTL 清理，单实例锁防并发重复推送

## 快速开始

```bash
npm install
cp config/.env.example config/.env   # 填入 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / BILI_COOKIE
node src/index.js                    # 手动跑一轮
```

Telegram API 在国内需走代理时，在 `config/.env` 中设置 `HTTP_PROXY`。

## 文档

- `PLAN.md` —— 产品计划与系统架构
- `LOG.md` —— 产品迭代日志
- `DEPLOY.md` —— 云服务器部署参考

## 合规与风险

- 本项目为**只读**工具：不自动参与 / 转发 / 评论抽奖，降低平台风控与账号风险。
- 请使用专用小号 Cookie 运行，注意账号安全；代码仅供学习交流，使用后果自负。
- 参考项目 [LotteryAutoScript](https://github.com/shanmiteko/LotteryAutoScript)（GPL-3.0）——若借鉴其代码实现，需按同源许可开源。
