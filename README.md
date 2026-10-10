# 教材互动模拟（小红书小工具）

参照人教版初中物理等教材的**知识点**（不用教材原文和插图），用 TypeScript + Vite + three.js 做写实风的互动模拟，打包成纯离线 HTML 上传小红书「小工具」，同一份 HTML 也可挂在自己的网站，供老师上课引用、家长给孩子玩。

## 目录
- `minigame/01-feasibility.md`：小红书小工具可行性调研与上传规格（zip ≤ 10MB，名称/简介 ≤ 14 字）
- `minigame/02-textbook-sims.md`：按教材知识点做模拟的规划
- `minigame/research/`：画风参考的复述
- `minigame/STYLE.md`：所有模拟统一的画面、界面、交互规范和每日流程
- `minigame/sims/01-buoyancy/`：第一个模拟「浮力实验室」（`buoyancy-lab.html` 打包好的离线页面，双击就能打开；`design.md` 设计稿，`app/` 代码，`mockup/` 效果图）
- `minigame/sims/02-water-cycle/`：「水去哪儿了」水循环，`STYLE.md` 的参照实现（`water-cycle.html` 打包好的离线页面；`design.md` 设计稿，`app/` 代码）
- `minigame/fonts/`：页面统一用的字体（Noto Sans SC）和许可

## 运行水循环
```bash
cd minigame/sims/02-water-cycle/app
npm install
npm run dev     # 本地预览
npm test        # 地形测试
npm run build   # 打包成 dist/index.html（离线单文件）
```

## 运行浮力实验室
```bash
cd minigame/sims/01-buoyancy/app
npm install
npm run dev     # 本地预览
npm test        # 物理模型测试
npm run build   # 打包成 dist/index.html（离线单文件，挂网站用）
npm run minitool   # 打包小红书小工具：dist-minitool/ 和 buoyancy-lab-minitool.zip
```

## 历史
旧路线（动物口吻图文账号、《高性价比人生指南》卡片）已于 2026-10-10 作废并删除，需要时可从提交 `37dbcc1` 找回。

## 许可
代码许可尚未选定（没有 LICENSE 文件）。页面字体 Noto Sans SC 按 SIL OFL 1.1 使用，见 `minigame/fonts/OFL.txt`。
