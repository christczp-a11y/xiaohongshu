# 小红书账号项目 · 工作规则

Chris（温哥华）的个人账号项目：猫咪简笔画（Notion 风）讲「高性价比人生指南」，目标是可验证的变现。
沟通按 Chris 的偏好：中文、简洁、给真实判断、不确定就说不确定，不要编。

## 流水线
`上游书 → tools/build_pool.py → content/pool.json → tools/make_post.py → content/posts/*.json → tools/render_cards.py → output/<slug>/*.png`
对标研究用 xiaohongshu-mcp 的**只读**工具，结果写 `research/benchmarks.csv`。

## 硬规则
1. **署名**：每篇笔记和每张卡片都带「内容改编自《高性价比人生指南》（eternity4719/HowToLiveBetter，CC BY 4.0）」。上游内容是 CC BY 4.0，不署名就是违约。
2. **不改写事实**：卡片正文只用上游「说人话」原句；成本行只由上游成本标签机械翻译。不新增数字、症状、机制解读（上游自己对这一栏就是这么规定的）。要加自己的内容，写在笔记正文里并标明是你的判断/经历。
3. **来源可查**：`content/pool.json` 里每条有 `sources`。涉及中国大陆法规、政策的条目，发布前去原文核一遍当前是否有效，我无法替你确认时效。
4. **先发低风险章节**：`risk=low`。医疗、法律、金融类（`medium/high`）容易被读成诊疗/法律建议，发之前必须人读过原条目的「备注」，带「争议」开头的先不发。
5. **不自动运营**：xiaohongshu-mcp 只用读类工具（`search_feeds`、`get_feed_detail`、`user_profile`、`list_feeds`、`check_login_status`）。不使用自动评论/点赞/收藏/回复工具；发布默认手动。平台明确反对用云端工具或脚本自动运营账号。研究请求要慢、少，不批量爬。
6. **AI 标注**：用 AI 生成的图/文按平台要求主动标注；发布前过 `docs/03-content-system.md` 的检查清单。
7. **不编造**：没读到的资料（比如那支 YouTube 视频正文）就说没读到。平台规则、门槛以官方公告/创作者中心为准，二手文章只当线索。
8. 提交信息和代码注释里不写模型名。

## 约定
- 卡片 1080×1440，Notion 风，猫主角在 `tools/cat.py`（5 种表情：happy/worry/think/idea/sleepy）。
- 笔记标题 ≤ 20 字，`make_post.py` 只校验、不替你缩写。
- 编号 `SS-NN` = 上游第 SS 节第 NN 条。
