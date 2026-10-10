# 字体

模拟页面的标题、页签、按钮统一用 Noto Sans SC（思源黑体的 Google 版本，SIL OFL 1.1，见 `OFL.txt`）：900 给标题，700 给页签和按钮，正文用系统字体。

- 来源：`@fontsource/noto-sans-sc@5.1.1` 的 chinese-simplified 切片（约 8200 个常用字）。
- 用法：每个模拟用自己的 `scripts/subset-font.py` 只截取页面用到的字，改名后打包进 HTML（OFL 保留了 "Source" 这个名字，所以子集要改名）。浮力实验室的两个子集各约 36KB。
