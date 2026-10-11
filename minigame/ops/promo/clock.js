(() => {
  let vt = 0, id = 0; const q = new Map();
  const realRAF = window.requestAnimationFrame.bind(window); (function tick(){ realRAF(tick); })();
  performance.now = () => vt;
  Date.now = (() => { const base = 1760140800000; return () => base + vt; })();
  window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => q.delete(i);
  window.__step = (ms) => { vt += ms; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } } };
})();
