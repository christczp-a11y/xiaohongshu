import * as THREE from 'three';
import { LIQUIDS, densityLabel, liquid, solid, type Liquid } from './data';
import { floatReadings, floatStart, floatStep, outcome, type FloatState } from './float';
import {
  DEFAULT_SETUP,
  capacityAtSpout,
  display,
  initialState,
  readings,
  round2,
  settle,
  step,
  type Setup,
  type State,
} from './physics';
import { QUALITY_TIERS, createScene, type FreeArea, type Mode, type SceneFrame, type SceneView } from './scene';

const START_BOTTOM = 13; // cube bottom above the cup floor, just clear of the water
const MIN_BOTTOM = 1; // never let a hung cube rest on the floor (the scale would read wrong)
const MAX_BOTTOM = 13;
const HOLD_Y = 13; // where a cube is held before it is let go in 浮还是沉
const H_MAX = DEFAULT_SETUP.spoutHeight - MIN_BOTTOM; // deepest the cube can go, for the chart

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
declare const __BUILD__: string;
{
  const el = document.createElement('div');
  el.id = 'build';
  el.textContent = __BUILD__;
  document.body.appendChild(el);
}
const pose = params.get('pose');

const canvas = $<HTMLCanvasElement>('c');

// --- boot: WebGL 2 check, then the scene; otherwise a still picture --------------------------
// three.js needs WebGL 2. Phones without it, or that fail to build a shader,
// get the still picture and the key ideas in words instead of a blank page.
let halted = false;
function showFallback(message: string, reload = false) {
  halted = true;
  $('fallbackMsg').textContent = message;
  $('fallbackReload').hidden = !reload;
  $('fallback').hidden = false;
}
$('fallbackReload').addEventListener('click', () => location.reload());

function boot(): SceneView | null {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return null;
    return createScene(canvas, DEFAULT_SETUP, () => showFallback('这台设备画不出这个 3D 实验，先看看静态的图和要点吧。'));
  } catch {
    return null;
  }
}
const booted = boot();
if (booted) run(booted);
else showFallback('这台设备暂时显示不了 3D 画面，先看看静态的图和要点吧。');

function run(view: SceneView) {
  const landscape = window.matchMedia('(min-aspect-ratio: 1/1)');

  type Labels = { G?: string; Fb?: string; Ft?: string; N?: string; cup: string };

  interface Controller {
    hint: string;
    enter(): void;
    grab(): void;
    drag(dy: number): void; // cm, up is positive
    release(): void;
    frame(dt: number, time: number): SceneFrame;
    labels: Labels;
  }

  const ease = (from: number, to: number, dt: number) => from + (to - from) * Math.min(1, dt * 14);
  const clamp = THREE.MathUtils.clamp;

  /** Fill a segmented control with buttons and keep one selected. */
  function segmented<T extends string>(el: HTMLElement, items: { id: T; label: string }[], value: T, pick: (id: T) => void) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'key';
      b.textContent = it.label;
      b.dataset.id = it.id;
      b.addEventListener('click', () => {
        if (b.classList.contains('on')) return;
        set(it.id);
        pick(it.id);
      });
      el.appendChild(b);
    }
    const set = (id: T) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    set(value);
    return set;
  }

  // --- 称一称: aluminium in water, overflow into the beaker ---------------------------------------
  function weighMode(): Controller {
    const s = DEFAULT_SETUP;
    let target = pose === 'full' ? 3.5 : pose === 'half' ? s.spoutHeight - s.cubeSide / 2 : START_BOTTOM;
    let state: State = pose ? settle(initialState(s, target), s) : initialState(s, START_BOTTOM);
    const out = { G: $('vG'), F: $('vF'), B: $('vB'), P: $('vP') };
    const eqrow = $('eqrow');
    const eqSign = $('eqSign');
    const eqNote = $('eqNote');
    const stepNo = $('stepNo');
    const stepText = $('stepText');

    $('reset').addEventListener('click', () => {
      state = initialState(s, START_BOTTOM);
      target = START_BOTTOM;
    });

    const c: Controller = {
      hint: '上下拖动，把铝块放进水里',
      labels: { cup: '水' },
      enter() {
        view.setSolid('aluminium');
        view.setLiquid('water');
      },
      grab() {},
      drag(dy) {
        target = clamp(target + dy, MIN_BOTTOM, MAX_BOTTOM);
      },
      release() {},
      frame(dt, time) {
        const before = state.beakerWater;
        state = step(state, ease(state.cubeBottom, target, dt), dt, s);
        const overflowing = state.beakerWater - before > 1e-4;
        const r = readings(state, s);
        const d = display(r);
        out.G.textContent = d.weight;
        out.F.textContent = d.scaleReading;
        out.B.textContent = d.buoyancy;
        out.P.textContent = d.beakerWeight;
        const inWater = r.buoyancy > 0.01;
        const full = r.submerged >= s.cubeSide - 1e-3;
        const match = d.buoyancy === d.beakerWeight && inWater && !overflowing;
        eqrow.classList.toggle('ok', match);
        eqSign.textContent = match ? '=' : inWater ? '…' : '?';
        eqNote.textContent = match
          ? '阿基米德原理'
          : inWater
            ? overflowing
              ? '水正在流进小烧杯'
              : '烧杯里有之前溢出的水，点「重做」再来'
            : '把铝块放进水里看看';
        const [n, text] = !inWater
          ? ['1', '先读测力计：铝块在空气中有多重？']
          : !full
            ? ['2', '慢慢往下放，盯着测力计的指针']
            : overflowing
              ? ['3', '全部浸没了，等溢出的水流完']
              : ['4', '比一比：浮力和溢出的水重'];
        stepNo.textContent = n;
        stepText.textContent = text;
        c.labels = {
          G: `G ${d.weight}N`,
          Fb: inWater ? `F浮 ${d.buoyancy}N` : undefined,
          Ft: `F拉 ${d.scaleReading}N`,
          cup: '水',
        };
        return {
          cubeBottom: state.cubeBottom,
          level: r.level,
          beakerWater: state.beakerWater,
          overflowing,
          scaleReading: r.scaleReading,
          forces: { G: r.weight, Fb: r.buoyancy, Ft: r.scaleReading, N: 0 },
          time,
        };
      },
    };
    return c;
  }

  // --- 变一变: change the liquid and the block, plot F浮 against depth ---------------------------
  function varyMode(): Controller {
    type L = Liquid['id'];
    type M = 'aluminium' | 'iron' | 'copper';
    let liq: L = 'water';
    let mat: M = 'aluminium';
    const setup = (): Setup => ({ ...DEFAULT_SETUP, cubeDensity: solid(mat).density, liquidDensity: liquid(liq).density });
    let s = setup();
    let target = pose === 'full' ? 3.5 : pose === 'half' ? s.spoutHeight - s.cubeSide / 2 : START_BOTTOM;
    let state: State = pose ? settle(initialState(s, target), s) : initialState(s, START_BOTTOM);
    // explored F浮 per liquid, binned every 0.1 cm of depth
    const curves = new Map<L, Map<number, number>>();
    let noteUntil = 0;
    let note = '';
    const out = { G: $('yG'), F: $('yF'), B: $('yB'), H: $('yH') };
    const text = $('varyText');
    const chart = $<HTMLCanvasElement>('chart');
    let chartKey = '';
    let lastRec: { liq: L; bin: number } | null = null;   // last depth sample, to bridge fast drags

    const say = (t: string) => {
      note = t;
      noteUntil = performance.now() + 4000;
    };
    segmented(
      $('varyLiquid'),
      LIQUIDS.map((l) => ({ id: l.id, label: l.name })),
      liq,
      (id) => {
        liq = id;
        s = setup();
        // swap the liquid with the block where it is: the cup is refilled to the
        // spout and the beaker starts empty
        state = { cupWater: capacityAtSpout(state.cubeBottom, s), beakerWater: 0, cubeBottom: state.cubeBottom };
        view.setLiquid(id);
        if (readings(state, s).submerged > 0) say(`同样的深度，换成${liquid(id).name}，F浮 变了`);
      },
    );
    segmented(
      $('varySolid'),
      (['aluminium', 'iron', 'copper'] as M[]).map((id) => ({ id, label: solid(id).name.slice(0, 1) })),
      mat,
      (id) => {
        mat = id;
        s = setup();
        view.setSolid(id);
        if (readings(state, s).submerged > 0) say('换了物块，G 变了，F浮 没变');
      },
    );
    $('clearChart').addEventListener('click', () => {
      curves.clear();
      lastRec = null;
      chartKey = '';
    });

    if (pose) {
      // screenshots: show what a pass through water and alcohol would have drawn
      for (const id of ['alcohol', 'water'] as L[]) {
        const m = new Map<number, number>();
        for (let i = 0; i <= Math.round((s.spoutHeight - target) * 10); i++) m.set(i, buoyancyAt(i / 10, liquid(id).density));
        curves.set(id, m);
      }
    }

    function buoyancyAt(h: number, density: number) {
      const a = DEFAULT_SETUP.cubeSide;
      return density * a * a * Math.min(h, a) * 1e-6 * DEFAULT_SETUP.g;
    }

    function drawChart(h: number, fb: number) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = Math.round(chart.clientWidth * dpr);
      const ht = Math.round(chart.clientHeight * dpr);
      if (!w || !ht) return;
      if (chart.width !== w || chart.height !== ht) {
        chart.width = w;
        chart.height = ht;
      }
      const g = chart.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = chart.clientWidth;
      const H = chart.clientHeight;
      const L = 30;
      const R = 10;
      const T = 8;
      const B = 18;
      const FMAX = 1.0;
      const x = (v: number) => L + (v / H_MAX) * (W - L - R);
      const y = (f: number) => T + (1 - f / FMAX) * (H - T - B);
      g.clearRect(0, 0, W, H);
      g.font = `500 10px ${getComputedStyle(document.body).fontFamily}`;
      g.lineWidth = 1;
      // grid and axes
      g.fillStyle = '#8e8e93';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      for (const f of [0, 0.5, 1]) {
        g.strokeStyle = f === 0 ? '#aeaeb2' : '#dcdce1';
        g.beginPath();
        g.moveTo(L, y(f) + 0.5);
        g.lineTo(W - R, y(f) + 0.5);
        g.stroke();
        g.fillText(f === 0 ? '0' : `${f}N`, L - 5, y(f));
      }
      g.textAlign = 'center';
      g.textBaseline = 'top';
      for (let v = 0; v <= H_MAX; v += 2) g.fillText(v === 0 ? 'h=0' : `${v}`, x(v), H - B + 5);
      g.fillText('cm', W - R, H - B + 5);
      // where the block is just fully under
      const a = DEFAULT_SETUP.cubeSide;
      g.strokeStyle = '#c7c7cc';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(Math.round(x(a)) + 0.5, T);
      g.lineTo(Math.round(x(a)) + 0.5, H - B);
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      g.fillText('刚好浸没', x(a) + 4, H - B - 2);
      // explored curves, older liquids in grey
      const order = [...curves.keys()].sort((p) => (p === liq ? 1 : -1));
      for (const id of order) {
        const bins = [...curves.get(id)!.entries()].sort((p, q) => p[0] - q[0]);
        if (bins.length < 2) continue;
        const on = id === liq;
        g.strokeStyle = on ? '#0071e3' : '#b8b8bd';
        g.lineWidth = on ? 2 : 1.5;
        g.beginPath();
        let prev = -9;
        for (const [b, f] of bins) {
          if (b - prev > 3) g.moveTo(x(b / 10), y(f));
          else g.lineTo(x(b / 10), y(f));
          prev = b;
        }
        g.stroke();
        const [lb, lf] = bins[bins.length - 1];
        if (lb / 10 > a + 1) {
          // the current liquid is named above its line, older ones below theirs
          g.fillStyle = on ? '#0071e3' : '#8e8e93';
          g.textAlign = 'right';
          g.textBaseline = on ? 'bottom' : 'top';
          g.fillText(liquid(id).name, x(lb / 10) - 8, on ? y(lf) - 3 : y(lf) + 3);
        }
      }
      // the block right now
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x(h), y(fb), 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0071e3';
      g.beginPath();
      g.arc(x(h), y(fb), 3.5, 0, Math.PI * 2);
      g.fill();
    }

    const c: Controller = {
      hint: '上下拖动，换液体、换物块比一比',
      labels: { cup: '水' },
      enter() {
        view.setSolid(mat);
        view.setLiquid(liq);
        chartKey = '';
      },
      grab() {},
      drag(dy) {
        target = clamp(target + dy, MIN_BOTTOM, MAX_BOTTOM);
      },
      release() {},
      frame(dt, time) {
        const before = state.beakerWater;
        state = step(state, ease(state.cubeBottom, target, dt), dt, s);
        const overflowing = state.beakerWater - before > 1e-4;
        const r = readings(state, s);
        const d = display(r);
        const h = clamp(r.level - state.cubeBottom, 0, H_MAX);
        out.G.textContent = d.weight;
        out.F.textContent = d.scaleReading;
        out.B.textContent = d.buoyancy;
        out.H.textContent = h.toFixed(1);

        let m = curves.get(liq);
        if (!m) curves.set(liq, (m = new Map()));
        const bin = Math.round(h * 10);
        // a quick drag moves several bins in one frame: fill the ones it skipped, so the line stays
        // solid instead of breaking into dashes (the chart only lifts the pen over unexplored depths)
        if (lastRec && lastRec.liq === liq && Math.abs(bin - lastRec.bin) > 1) {
          const dir = bin > lastRec.bin ? 1 : -1;
          for (let b = lastRec.bin + dir; b !== bin; b += dir) {
            // the skipped depths take the model's steady value, so the knee at 刚好浸没 stays sharp
            if (!m.has(b)) m.set(b, buoyancyAt(b / 10, liquid(liq).density));
          }
          chartKey = '';
        }
        if (!m.has(bin)) {
          m.set(bin, r.buoyancy);
          chartKey = '';
        }
        lastRec = { liq, bin };
        const key = `${liq}|${bin}|${round2(r.buoyancy)}|${chart.clientWidth}`;
        if (key !== chartKey) {
          chartKey = key;
          drawChart(h, r.buoyancy);
        }

        const full = r.submerged >= s.cubeSide - 1e-3;
        const tried = [...curves.values()].filter((v) => v.size > 20).length;
        text.textContent =
          performance.now() < noteUntil
            ? note
            : r.submerged <= 0
              ? `往下拖，把${solid(mat).name}放进${liquid(liq).name}里`
              : !full
                ? '浸入越深，排开的液体越多，F浮 越大'
                : tried >= 2
                  ? '都浸没时：液体密度越大，F浮 越大'
                  : '浸没以后再往下，F浮 不变了';
        const inLiquid = r.buoyancy > 0.005;
        c.labels = {
          G: `G ${d.weight}N`,
          Fb: inLiquid ? `F浮 ${d.buoyancy}N` : undefined,
          Ft: `F拉 ${d.scaleReading}N`,
          cup: liquid(liq).name,
        };
        return {
          cubeBottom: state.cubeBottom,
          level: r.level,
          beakerWater: state.beakerWater,
          overflowing,
          scaleReading: r.scaleReading,
          forces: { G: r.weight, Fb: r.buoyancy, Ft: r.scaleReading, N: 0 },
          time,
        };
      },
    };
    return c;
  }

  // --- 浮还是沉: let go and see where the block ends up -------------------------------------------
  function floatMode(): Controller {
    type L = Liquid['id'];
    type M = 'wood' | 'wax' | 'aluminium' | 'iron';
    let liq: L = 'water';
    let mat: M = 'wood';
    const setup = (): Setup => ({ ...DEFAULT_SETUP, cubeDensity: solid(mat).density, liquidDensity: liquid(liq).density });
    let s = setup();
    let st: FloatState = floatStart(s, HOLD_Y);
    let target = HOLD_Y;
    const out = { Rs: $('zRs'), Rl: $('zRl'), G: $('zG'), B: $('zB') };
    const text = $('floatText');
    const dropBtn = $<HTMLButtonElement>('drop');

    function restart() {
      s = setup();
      st = floatStart(s, HOLD_Y);
      target = HOLD_Y;
      out.Rs.textContent = densityLabel(s.cubeDensity);
      out.Rl.textContent = densityLabel(s.liquidDensity);
    }
    function letGo() {
      if (!st.held) return;
      st = { ...st, held: false, v: 0 };
    }
    segmented(
      $('floatSolid'),
      (['wood', 'wax', 'aluminium', 'iron'] as M[]).map((id) => ({ id, label: solid(id).name.slice(0, 1) })),
      mat,
      (id) => {
        mat = id;
        view.setSolid(id);
        restart();
      },
    );
    segmented(
      $('floatLiquid'),
      LIQUIDS.map((l) => ({ id: l.id, label: l.name })),
      liq,
      (id) => {
        liq = id;
        view.setLiquid(id);
        restart();
      },
    );
    $('floatReset').addEventListener('click', restart);
    dropBtn.addEventListener('click', letGo);

    restart();
    if (pose) {
      // screenshots: let it settle first
      letGo();
      for (let i = 0; i < 600; i++) st = floatStep(st, 1 / 30, s);
    }

    const c: Controller = {
      hint: '拖动物块，松手看它浮还是沉',
      labels: { cup: '水' },
      enter() {
        view.setSolid(mat);
        view.setLiquid(liq);
      },
      grab() {
        st = { ...st, held: true, v: 0 };
        target = st.y;
      },
      drag(dy) {
        target = clamp(target + dy, 0, HOLD_Y);
      },
      release() {
        letGo();
      },
      frame(dt, time) {
        if (st.held) st = { ...st, y: ease(st.y, target, dt) };
        st = floatStep(st, dt, s);
        const r = floatReadings(st, s);
        const G = round2(r.weight);
        const Fb = round2(r.buoyancy);
        out.G.textContent = G.toFixed(2);
        out.B.textContent = Fb.toFixed(2);
        dropBtn.disabled = !st.held;

        const rs = densityLabel(s.cubeDensity);
        const rl = densityLabel(s.liquidDensity);
        const end = outcome(s);
        text.textContent = st.held
          ? '猜一猜：松手后它会浮起来，还是沉下去？'
          : !r.resting
            ? '看它往哪儿走……'
            : end === 'float'
              ? `漂浮：ρ物 ${rs} < ρ液 ${rl}，F浮 = G`
              : end === 'sink'
                ? `沉底：ρ物 ${rs} > ρ液 ${rl}，F浮 < G，杯底托着它`
                : `悬浮：ρ物 = ρ液，F浮 = G`;
        // the support only appears once the block is resting on the floor
        const N = round2(r.support);
        c.labels = {
          G: `G ${G.toFixed(2)}N`,
          Fb: r.buoyancy > 0.005 ? `F浮 ${Fb.toFixed(2)}N` : undefined,
          N: N > 0 ? `F支 ${(G - Fb).toFixed(2)}N` : undefined,
          cup: liquid(liq).name,
        };
        return {
          cubeBottom: st.y,
          level: r.level,
          beakerWater: 0,
          overflowing: false,
          scaleReading: 0,
          forces: { G: r.weight, Fb: r.buoyancy, Ft: 0, N: r.support },
          time,
        };
      },
    };
    return c;
  }

  // --- wiring ---------------------------------------------------------------------------------------
  const controllers: Record<Mode, Controller> = { weigh: weighMode(), vary: varyMode(), float: floatMode() };
  const initial = params.get('mode');
  let mode: Mode = initial === 'vary' || initial === 'float' ? initial : 'weigh';
  let ctl = controllers[mode];
  const app = $('app');
  const hint = $('hint');
  const hintText = $('hintText');
  const seen = new Set<Mode>();

  function setMode(m: Mode) {
    mode = m;
    ctl = controllers[m];
    app.dataset.mode = m;
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll<HTMLElement>('.panel').forEach((p) => (p.hidden = p.dataset.for !== m));
    view.setMode(m);
    ctl.enter();
    hintText.textContent = ctl.hint;
    hint.classList.toggle('gone', seen.has(m) || !!pose);
    hint.querySelector('.hand')!.textContent = m === 'float' ? '☝' : '↕';
    layout();
  }
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) =>
    b.addEventListener('click', () => b.dataset.mode !== mode && setMode(b.dataset.mode as Mode)),
  );

  // drag to raise / lower
  let dragY: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    seen.add(mode);
    hint.classList.add('gone');
    ctl.grab();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    ctl.drag(-(e.clientY - dragY) * view.cmPerPixel());
    dragY = e.clientY;
  });
  const endDrag = () => {
    if (dragY === null) return;
    dragY = null;
    canvas.classList.remove('dragging');
    ctl.release();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    seen.add(mode);
    hint.classList.add('gone');
    ctl.drag(e.key === 'ArrowDown' ? -0.5 : 0.5);
  });

  const arrowBtn = $('arrowToggle');
  let arrowsOn = true;
  arrowBtn.addEventListener('click', () => {
    arrowsOn = !arrowsOn;
    arrowBtn.setAttribute('aria-pressed', String(arrowsOn));
    view.setArrows(arrowsOn);
  });
  // a plain overlay rather than <dialog>: older WebViews have no showModal()
  const about = $('about');
  $('aboutBtn').addEventListener('click', () => (about.hidden = false));
  $('aboutClose').addEventListener('click', () => (about.hidden = true));
  about.addEventListener('click', (e) => {
    if (e.target === about) about.hidden = true;
  });

  // layout
  const dock = $('dock');
  const tabs = $('tabs');
  const insetEl = $('inset');
  function layout() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const t = tabs.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const free: FreeArea = landscape.matches
      ? { top: t.bottom + 8, bottom: 8, left: 8, right: W - d.left + 12 }
      : { top: t.bottom + 10, bottom: H - d.top + 4, left: 0, right: 0 };
    view.resize(W, H, free);
    if (mode === 'float' || params.has('still')) view.setInset(null); // ?still: for the fallback picture
    else {
      const r = insetEl.getBoundingClientRect();
      const b = insetEl.clientLeft;
      view.setInset({ x: r.left + b, y: r.top + b, w: r.width - 2 * b, h: r.height - 2 * b });
    }
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('pageshow', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  if (document.fonts) document.fonts.ready.then(layout, () => {});
  setMode(mode);

  // --- loop ---------------------------------------------------------------------------------------
  const tags = { G: $('lblG'), Fb: $('lblB'), Ft: $('lblT'), N: $('lblN'), cup: $('lblCup') };
  const proj = new THREE.Vector3();
  const spot = { x: 0, y: 0 };
  const fbSpot = { x: 0, y: 0 };
  // ?tier=N pins a quality tier; ?stats shows draw calls and triangles per frame.
  // Otherwise start one step below the best and climb only with room to spare.
  const pinned = params.get('tier');
  let tier = pinned === null ? 1 : clamp(Number(pinned) || 0, 0, QUALITY_TIERS - 1);
  let mayRise = pinned === null;
  view.setQuality(tier);
  const statsEl = params.has('stats') ? document.body.appendChild(document.createElement('div')) : null;
  if (statsEl) statsEl.style.cssText = 'position:fixed;left:8px;bottom:4px;font:11px monospace;color:#c00;z-index:9';
  let last = 0;
  let rafId = 0;
  let running = false;
  let slowTime = 0;
  let busyTime = 0;
  let sampleTime = 0;
  let warmUp = 0;
  let statsTick = 0;
  function startLoop() {
    if (running || halted) return;
    running = true;
    last = 0; // no catching up on the time spent hidden
    slowTime = busyTime = sampleTime = 0;
    warmUp = 1;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    cancelAnimationFrame(rafId);
  }
  // step down a tier while frames stay slow (< 24 fps for half of 3 s); at
  // the lowest tier give up below ~12 fps and show the still picture. Step up
  // once if nearly every frame keeps 40 fps; never again after a step down.
  // The first second after a start or a tier change (shaders compiling) and
  // single hitches over half a second don't count.
  function watch(raw: number) {
    if (pinned !== null) return;
    if (warmUp > 0) {
      warmUp -= raw;
      return;
    }
    if (raw > 0.5) return;
    sampleTime += raw;
    if (raw > (tier < QUALITY_TIERS - 1 ? 1 / 24 : 1 / 12)) slowTime += raw;
    if (raw > 1 / 40) busyTime += raw;
    if (sampleTime < 3) return;
    const slow = slowTime / sampleTime;
    const busy = busyTime / sampleTime;
    slowTime = busyTime = sampleTime = 0;
    if (slow < 0.5) {
      if (mayRise && tier > 0 && busy < 0.05) {
        view.setQuality(--tier);
        warmUp = 1;
      }
      return;
    }
    mayRise = false;
    if (tier < QUALITY_TIERS - 1) {
      view.setQuality(++tier);
      warmUp = 1;
    } else {
      stopLoop();
      showFallback('这台设备画 3D 有点吃力，先看看静态的图和要点吧。');
    }
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopLoop();
    showFallback('画面暂停了。点下面的按钮重新打开。', true);
  });

  // The phone's safe areas, fonts and the panel's height can all settle after the first layout
  // without a resize event; the 3D framing and the close-up follow them on a clock.
  let layoutAt = 0;
  let layoutKey = '';
  function layoutChanged() {
    const r = insetEl.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const t = tabs.getBoundingClientRect();
    const key = [canvas.clientWidth, canvas.clientHeight, d.top, d.height, t.bottom, r.left, r.top, r.width, r.height].join('|');
    if (key === layoutKey) return false;
    layoutKey = key;
    return true;
  }
  function frame(now: number) {
    if (!running || halted) return;
    rafId = requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    watch(raw);
    const dt = Math.min(raw, 1 / 20);
    const f = ctl.frame(dt, now / 1000);
    view.update(f);
    view.render();
    if (now - layoutAt > 250) {
      layoutAt = now;
      if (layoutChanged()) layout();
    }
    const a = view.anchors();
    const L = ctl.labels;
    placeTag(tags.G, a.G, 0, 1, L.G, arrowsOn);
    const fb = placeTag(tags.Fb, a.Fb, -1, 0, L.Fb, arrowsOn);
    placeTag(tags.Ft, a.Ft, 1, 0, L.Ft, arrowsOn);
    placeTag(tags.N, a.N, 1, 0, L.N, arrowsOn);
    // the liquid's name sits left of the cup like F浮; lift it clear when they meet
    fbSpot.x = fb.x;
    fbSpot.y = fb.y;
    const cup = screen(a.cup);
    const clash = arrowsOn && L.Fb && Math.abs(cup.x - fbSpot.x) < 110 && Math.abs(cup.y - fbSpot.y) < 30;
    placeTag(tags.cup, a.cup, -1, 0, L.cup, true, clash ? fbSpot.y - 30 - cup.y : 0);
    if (statsEl && (statsTick += raw) > 0.5) {
      statsTick = 0;
      const i = view.info();
      statsEl.textContent = `tier ${tier} · ${i.calls} calls · ${i.triangles} tris · dpr ${i.dpr.toFixed(2)}`;
    }
  }

  /** Pin a label next to an anchor; sx/sy pick the side (-1, 0, 1). */
  function screen(p: THREE.Vector3) {
    proj.copy(p).project(view.camera);
    spot.x = (proj.x * 0.5 + 0.5) * canvas.clientWidth;
    spot.y = (-proj.y * 0.5 + 0.5) * canvas.clientHeight;
    return spot;
  }

  function placeTag(
    el: HTMLElement,
    p: THREE.Vector3,
    sx: number,
    sy: number,
    text: string | undefined,
    visible: boolean,
    dy = 0,
  ) {
    const s = screen(p);
    const x = s.x + sx * 8;
    const y = s.y + sy * 10 + dy;
    el.style.transform = `translate(${x}px, ${y}px) translate(${-50 + sx * 50}%, ${-50 + sy * 50}%)`;
    el.style.opacity = visible && text ? '1' : '0';
    if (text && el.textContent !== text) el.textContent = text;
    return s;
  }

  startLoop();
}
