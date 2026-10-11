const { chromium } = require(process.env.PW);
const fs = require('fs');
const W = process.env.PROMO_DIR || '/tmp/claude-0/promo';
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto(`file://${W}/compose.html`);
  await p.evaluate(async () => { await document.fonts.load('900 100px NS', '浮力'); await document.fonts.load('700 100px NS', '浮力'); await document.fonts.ready; });
  const ptr = fs.existsSync(`${W}/ptr.json`) ? JSON.parse(fs.readFileSync(`${W}/ptr.json`)) : [];
  await p.evaluate((x) => window.setPtr(x), ptr);
  await p.evaluate((x) => window.setEvents(x), JSON.parse(fs.readFileSync(`${W}/events.json`)));
  const cdp = await p.context().newCDPSession(p);
  fs.mkdirSync(`${W}/out`, { recursive: true });
  const list = only || [...Array(450).keys()];
  for (const i of list) {
    await p.evaluate((f) => window.render(f), i);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${W}/out/c${String(i).padStart(3, '0')}.png`, Buffer.from(r.data, 'base64'));
    if (i % 60 === 0) console.log('c', i, new Date().toISOString());
  }
  await b.close();
})();
