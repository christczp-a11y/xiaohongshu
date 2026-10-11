// 在云端模拟「小红书 iPhone 小工具容器」打开一个模拟，截图看版面。
// 模拟的是 Chris 真机上量出来的条件（见 minigame/SERIES.md「小红书容器」）：
//   - 视口 428×926、DPR 2、触屏
//   - 安全区晚到：页面加载 1.5 秒后才注入顶部 47px、底部 34px（iOS 的 env() 就是这样晚生效的）
//   - 容器的返回键、头像键、分享键画成灰色圆点，盖在页面上面
//   - 底部画一条 Home 横条
// 截图：打开时一张，然后依次点每个页签各一张。同时打印页签、底部面板的位置和 3D 区高度。
//
// 用法（在某个模拟的 app/ 目录下）：
//   npm run minitool
//   python3 -m http.server 8773 -d dist-minitool &
//   PW=/opt/node22/lib/node_modules/playwright node ../../../tools/xhs-sim.js "http://localhost:8773/?tier=3" /tmp/shot
//   PW=... node ../../../tools/xhs-sim.js "http://localhost:8773/?tier=3" /tmp/shot-small 375 812
// PW 指向 playwright 包（云端容器里是上面那个路径；本机装了 playwright 就不用设）。
// ?tier=3 让软件渲染跑最低画质档，截图更快；看画质时去掉。
// 这只是浏览器模拟，不能代替真机验证。
const { chromium } = require(process.env.PW || 'playwright');

const [, , url, prefix, w = '428', h = '926'] = process.argv;
if (!url || !prefix) {
  console.log('usage: node xhs-sim.js <url> <out-prefix> [width height]');
  process.exit(2);
}
const TABS = process.env.TABS || '#tabs button'; // 页签按钮的选择器，没有页签的模拟会自动跳过
const PANEL = process.env.PANEL || '#dock'; // 底部面板

(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: +w, height: +h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const W = window.innerWidth;
      const dot = (left, top) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:31px;height:31px;border-radius:50%;` +
          'background:rgba(120,120,128,.55);z-index:99;pointer-events:none';
        document.body.appendChild(d);
      };
      dot(12, 53); // 返回
      dot(W - 88, 53); // 头像
      dot(W - 44, 53); // 分享
      const home = document.createElement('div');
      home.style.cssText = 'position:fixed;left:50%;bottom:8px;width:134px;height:5px;margin-left:-67px;' +
        'border-radius:3px;background:#000;z-index:99;pointer-events:none';
      document.body.appendChild(home);
    });
  });

  const report = async (label) => {
    const m = await page.evaluate(([tabsSel, panelSel]) => {
      const rect = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      const tabBtn = document.querySelector(tabsSel);
      return { H: innerHeight, tabs: tabBtn ? rect(tabsSel.split(' ')[0]) : null, panel: rect(panelSel) };
    }, [TABS, PANEL]);
    const top = m.tabs ? m.tabs.bottom : 85; // 没有页签时，从容器按钮那条带下面算起
    const bottom = m.panel ? m.panel.top : m.H;
    const free = bottom - top;
    console.log(`${label}: 屏高 ${m.H}，页签 ${m.tabs ? m.tabs.top + '–' + m.tabs.bottom : '无'}，` +
      `面板 ${m.panel ? m.panel.top + '–' + m.panel.bottom : '无'}，3D 区 ${free}px（${Math.round(free / m.H * 100)}%）`);
  };

  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty('--safe-area-inset-top', '47px');
    s.setProperty('--safe-area-inset-bottom', '34px');
  });
  await page.waitForTimeout(6000);
  await report('打开');
  await page.screenshot({ path: `${prefix}-0.png` });

  const n = await page.locator(TABS).count();
  for (let i = 1; i < n; i++) {
    await page.locator(TABS).nth(i).click();
    await page.waitForTimeout(2500);
    await report(`页签 ${i + 1}`);
    await page.screenshot({ path: `${prefix}-${i}.png` });
  }
  await browser.close();
})();
