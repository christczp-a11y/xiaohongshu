# 每日出稿规范（G-man）

Chris 2026-10-11 发完 Day 1 后说「记住我的设置、我的文案，下次自动来」。以下按他 Day 1 实际发布页截图整理，以后照搬，只换课。

## 什么时候做

main 上出现新一集模拟（`minigame/sims/NN-英文名/`），或者 Chris 在运营线程说「Day N」，就开工：先把模拟打开玩一遍，看清楚有哪些功能、哪些数字，再出下面这一整套。不用再问 Chris，只问真正缺的（比如这课进哪个合集）。

Day N 按实际发帖顺序数，和模拟目录的 NN 编号不是一回事：Day 1 是浮力实验室，水循环（`02-water-cycle`）没发，不占编号，Day 2 是四冲程汽油机。

Chris 本机的会话也可能在做同一集的图文，开工前先对齐，别重复做。

## 一整套出什么

1. **瑞士海报风图文 5 张**：3:4（1080×1440），黑白＋一个瑞士红。图上的数字必须从模拟里实际读出来，不能编。第 1 张是封面（大字课名，Day 1 是「浮力 / 实验室」）。
   - 2026-10-11 起笔记改成图文，不再做宣传视频（Chris：「以后不用视频推了 做图片吧」）。下面「视频怎么做」一节留作存档。
2. **标题**：`课题名互动课件｜学段学科教学`，20 字以内（例：`四冲程汽油机互动课件｜初中物理教学`）。Chris 2026-10-11 定的：「关键 SEO 应该是 课件+教学+互动+课题名」，只放课名太窄。Day N 不进标题，放正文第一行。
3. **正文**（只换 N 和课名，其余一字不改）：

   ```
   Day N：课名
   Flag：N/365
   欢迎使用，感谢意见。
   希望小朋友能从科技理解抽象概念。
   ```

4. **标签**：固定 6 个＋当课 5 个左右。
   - 固定：`#ai工具 #howto用好AI #vibecoding #互动课件 #threejs #独立开发`
   - 当课：`#课题名 #物理课件 #物理教学 #章节名 #年级物理`，例 Day 2：`#四冲程汽油机 #物理课件 #物理教学 #热机 #九年级物理`（Day 1 当时是 `#阿基米德原理 #初中物理 #物理实验`）
   - 注：他之前文字里说的 `#Ai进化生活`，发布时换成了 `#ai工具`，以发布版为准。

文案别加料，别写成运营腔。

## 发布前提醒 Chris

- 笔记下面挂当天的小工具。小工具名称和简介不超过 14 个字；Day 1 简介他写的是「Threejs模拟真实实验」。
- 按平台要求标注 AI 生成。
- 放进对应学科的合集（Day 1 在「初中物理」）。
- 不写没核实过的话。例如「搜『浮力实验室』就能找到」这种，没确认小工具能被搜到之前不写。

## 视频怎么做（2026-10-11 起停用，存档）

脚本在 `promo/`，是 Day 1 的版本：

| 文件 | 干什么 |
| --- | --- |
| `clock.js` | 注入模拟页面，接管 `performance.now`、`Date.now`、`requestAnimationFrame`，用 `window.__step(ms)` 一帧一帧推时间。 |
| `rec.cjs` | Playwright（swiftshader）按 390×844、DPR 3、`?tier=0` 录模拟，按脚本拖动和点击，输出 `frames2/`、手指轨迹 `ptr.json`、关键事件帧号 `events.json`。 |
| `compose.html` | 1080×1920 合成舞台：手机样机、镜头、字幕、章节、片头片尾、变速映射（`MAP`）、镜头关键帧（`CAM`）。 |
| `compose.cjs` | 逐帧渲染 `compose.html`，输出 `out/c000.png` 到 `out/c449.png`。 |
| `sound.py` | 用 numpy 合成配乐和音效（按 `events.json` 和视频时间点对齐），输出 wav。 |

跑法（工作目录用 `PROMO_DIR`，默认 `/tmp/claude-0/promo`）：

1. 把当集模拟的单文件 html 拷成 `$PROMO_DIR/sim.html`；把 `clock.js`、`compose.html` 拷进同一目录；把 `minigame/fonts/noto-sans-sc-900.woff2`、`noto-sans-sc-700.woff2` 拷成 `noto900.woff2`、`noto700.woff2`。
2. `PW=<playwright 模块路径> node rec.cjs`
3. `PW=<playwright 模块路径> node compose.cjs`
4. `ffmpeg -framerate 30 -i $PROMO_DIR/out/c%03d.png -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -movflags +faststart video.mp4`
5. `python3 sound.py`，然后 `ffmpeg -i video.mp4 -i $PROMO_DIR/day01-sound.wav -c:v copy -c:a aac -b:a 192k -af loudnorm=I=-16:TP=-1.5:LRA=11 -shortest final.mp4`

每集要改的：`rec.cjs` 里的操作脚本、`compose.html` 里的课名、字幕、章节、`MAP` 和 `CAM`、`sound.py` 里的音效时间点。

坑：

- 只覆盖 rAF 会让截图卡 20 秒以上，`clock.js` 里保留了一个真 rAF 空转；截图用 CDP `Page.captureScreenshot` 的 png（jpeg 很慢）。
- 慢过程不要硬等，录到事件发生（比如 `#eqrow` 变成 `ok`）记下帧号，合成时用 `MAP` 快进。
