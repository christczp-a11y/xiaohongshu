const { chromium } = require(process.env.PW);
const fs = require('fs');
const W = process.env.PROMO_DIR || '/tmp/claude-0/promo';
const DIR = `${W}/frames2`;
fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await p.addInitScript({ path: `${W}/clock.js` });
  await p.goto(`file://${W}/sim.html?tier=0`);
  await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  const step = async () => { await p.evaluate(() => { window.__step(1000 / 60); window.__step(1000 / 60); }); };
  for (let i = 0; i < 40; i++) await p.evaluate(() => window.__step(1000 / 60));
  const center = async (sel) => { const bb = await p.locator(sel).boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
  const ptr = [], ev = {};
  let cur = null, tapUntil = -1, tapAt = null, f = 0;
  const shoot = async () => {
    await step();
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${DIR}/f${String(f).padStart(3, '0')}.png`, Buffer.from(r.data, 'base64'));
    ptr.push(cur ? { x: cur[0], y: cur[1], down: true } : f <= tapUntil && tapAt ? { x: tapAt[0], y: tapAt[1], tap: f - (tapUntil - 10) } : null);
    if (f % 30 === 0) console.log('frame', f, new Date().toISOString());
    f++;
  };
  const tap = async (sel, name) => { tapAt = await center(sel); await p.mouse.click(...tapAt); tapUntil = f + 10; ev[name] = f; };
  const drag = async (x, y0, dy, n, name) => {
    cur = [x, y0]; await p.mouse.move(...cur); await p.mouse.down(); ev[name] = f;
    for (let i = 1; i <= n; i++) { cur = [x, y0 + dy * i / n]; await p.mouse.move(...cur); await shoot(); }
    for (let i = 0; i < 8; i++) await shoot();
    await p.mouse.up(); cur = null; ev[name + 'End'] = f;
  };
  const idle = async (n) => { for (let i = 0; i < n; i++) await shoot(); };

  // 01 weigh
  await idle(15);
  await drag(195, 330, 58, 45, 'weighDrag');
  let lit = 0;
  while (f < 600) { await shoot(); if (await p.evaluate(() => document.getElementById('eqrow').classList.contains('ok'))) { lit = f; break; } }
  ev.eqLit = lit;
  await idle(24);
  // 02 vary
  await tap('#tabs button[data-mode=vary]', 'vary');
  await idle(8);
  await drag(195, 300, 58, 30, 'varyDrag');
  await idle(14);
  await tap('#varyLiquid button[data-id=brine]', 'brine');
  await idle(40);
  // 03 float
  await tap('#tabs button[data-mode=float]', 'float');
  await idle(14);
  await tap('#drop', 'drop');
  await idle(70);
  ev.total = f;
  fs.writeFileSync(`${W}/ptr.json`, JSON.stringify(ptr));
  fs.writeFileSync(`${W}/events.json`, JSON.stringify(ev));
  console.log(JSON.stringify(ev));
  await b.close();
})();
