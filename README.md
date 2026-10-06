# 小红书账号：动物口吻的心理抚慰（图文）

用**动物的第一人称口吻**，给容易紧张的人送一个能带走的心态。心理抚慰，不是科普；真诚和共鸣第一；初期目标每月到手 ¥500。

> 当前路线见 [`docs/08-route.md`](docs/08-route.md)（唯一有效）；工作规则见 [`CLAUDE.md`](CLAUDE.md)。

## 现在处于哪一步
**P0：文字阶段，还没有发布任何一篇。** 现有文字样稿（v6，文风「接住情绪」）：
- [`content/posts/cat-voice-v6.md`](content/posts/cat-voice-v6.md)：猫的口吻，《我是猫，不想去的地方我就不去》
- [`content/posts/turtle-voice-v6.md`](content/posts/turtle-voice-v6.md)：乌龟的口吻，《今天只做了一件事，也算一天》

图片要等 P1 关卡（在本机用 Codex 出图），目前稿子里只有出图提示词。

## 怎么做一篇（流程）
1. 先定**读者要的心态**，再找对应的**动物习性**。
2. 按 **Viral Writer** 构思出稿，再按 **humanizer-zh** 修订（过滤规则见 `CLAUDE.md` 规则 10）。
3. 自查：无疗效表述、不编亲历、不写"所有猫都……"。
4. 写出图提示词 → 用户确认 → **手动发布**。

## 目录
| 路径 | 内容 |
|---|---|
| `docs/08-route.md` | **现行路线**：决策、严谨度分档、写稿流程、视觉方向、变现、阶段关卡、未决事项 |
| `docs/07-animal-direction-feasibility.md` | 可行性分析：钱的算术、版权与 AI 图风险、出图前关卡 G1–G3、12 篇测试（部分内容已被 08 修订） |
| `docs/04-visual-style.md` | 视觉规范（顶部指向 08；下半部分是旧路线的 Notion 风） |
| `docs/05-setup.md` | xiaohongshu-mcp 安全事实与安装、Codex 出图接入 |
| `docs/02-competitor-research.md` | 对标研究 SOP |
| `content/posts/` | 当前样稿 |
| `content/animal/` | 故事卡模板（仅第 3 档"研究类"内容用）、命题核查 |
| `research/` | 对标拆解、小红书机制笔记、画风证据、给 Codex 的任务单、来源日志 |
| `tools/` | 旧路线的选题池与卡片渲染；`sketch.py` 是代码绘制的铅笔占位图 |
| `docs/archive/`、`content/posts/archive/` | **已归档**的旧路线文档、样稿与示例图，仅作历史参考 |

## 状态
| 项 | 状态 |
|---|---|
| 路线与规则 | 已定（`docs/08-route.md`） |
| 文字样稿 | v6（猫、乌龟），**待用户反馈与真实细节确认** |
| 文风样例 | 待用户提供 |
| 猫头像 | 待用户试画 |
| 出图 | 未开始（P1 关卡） |
| 平台规则核实（AI 标注、心理类内容、微信表情/店铺对 AI 素材） | **待用户在官方页面确认** |
| 第二轮对标搜索 | 任务单已更新，待 Codex 在用户本机执行 |
| 已发布笔记 | 0 篇 |

## 备选路线（冻结）：《高性价比人生指南》
旧路线把上游书的 665 条建议做成卡片。管线仍可用：
```bash
pip install -r requirements.txt
python tools/build_pool.py                 # 上游 → content/pool.json
python tools/make_post.py --list --risk low --ratio 极高
python tools/render_cards.py content/posts/archive/demo-save-money.json
```
该书内容为 CC BY 4.0，使用时必须署名；`content/pool.json` 是其结构化副本，沿用 CC BY 4.0。

## 许可
现行路线的文字和图为原创，不受上述署名要求约束。本仓库自身的代码许可尚未选定（没有 LICENSE 文件），由所有者决定。
