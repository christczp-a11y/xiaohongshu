# 05 · 环境与 MCP

## 两个 MCP 的分工

| MCP | 用来干什么 | 不能干什么 |
|---|---|---|
| [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 在小红书上搜笔记、看详情/评论、看博主主页（对标研究） | 它是第三方项目，不是官方 API；发布/互动类工具有账号风险 |
| [Context7](https://github.com/upstash/context7) | 查**技术库**的最新文档（Playwright、Python 库等），写工具时用 | **查不了小红书平台规则/变现政策**——那类以官方公告和创作者中心为准 |

`.mcp.json` 已写好两个 server 的配置。

## xiaohongshu-mcp 的一个安全事实（2026-10-05 读源码确认，版本 a5c8f77）

- 它**拒绝使用本机 Chrome**，只用自己从第三方 CDN `cdn.one-world.ai/browsers` 下载的"内置浏览器"（140–190MB 的定制 Chromium），源码里还带指纹伪装参数。
- 下载后会校验 SHA256，但校验文件 `SHA256SUMS` 取自**同一个 CDN**，只能防传输损坏，不能证明二进制可信。
- 这个浏览器会持有你的小红书登录态（cookie）。我没法审计它。
- 所以：**我没有在云端容器里登录你的账号。** 要不要在你自己的电脑上信任它，是你的决定；信任的话，用小号或评估过风险后再登录主号。其余源码对外只访问 xiaohongshu.com / creator.xiaohongshu.com。

## xiaohongshu-mcp（在你自己的电脑上跑）

**不要在云端容器里登录**：登录要人工扫码；云端是机房 IP，和你平时的登录环境差别大，容易触发风控；而且你看不到浏览器。

```bash
# 1) 从 GitHub Releases 下载对应系统的二进制（或 Docker：docker compose up -d）
# 2) 先登录（弹浏览器，手动扫码，保存 cookie）
./xiaohongshu-login-darwin-arm64
# 3) 启动服务，默认 http://localhost:18060/mcp
./xiaohongshu-mcp-darwin-arm64
# 4) 在本机的 Claude Code 里注册（或直接用本仓库的 .mcp.json）
claude mcp add --transport http xiaohongshu-mcp http://localhost:18060/mcp
```

以上来自该项目 README（我读取的是其摘要）。命令名按你的系统替换，以 Releases 页面为准。验证：`npx @modelcontextprotocol/inspector` 连 `http://localhost:18060/mcp` 看工具列表。

> `.mcp.json` 里的 `localhost:18060` 只有在 **Claude Code 和服务跑在同一台机器上** 时才通。云端会话里它会显示连接失败，这是预期的。

### 工具白名单（本项目约定）

可用：`check_login_status` `search_feeds` `get_feed_detail` `user_profile` `list_feeds`
不用：`publish_content` `publish_with_video` `post_comment_to_feed` `reply_comment_in_feed` `like_feed` `favorite_feed` `delete_cookies`
原因见 `01-strategy.md` 风险 2。

## Context7

```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

包名 `@upstash/context7-mcp` 已在 npm 上核实存在。工具：`resolve-library-id`、`query-docs`。用法：提示里直接写"use context7"，或指定库 ID（如 `/microsoft/playwright`）。

## 本仓库的 Python 环境

```bash
pip install -r requirements.txt     # 只需要 playwright
python tools/build_pool.py          # 首次会 clone 上游到 .cache/source
```

渲染用本机 Chrome/Chromium；找不到时设 `CHROME=/path/to/chrome`。
