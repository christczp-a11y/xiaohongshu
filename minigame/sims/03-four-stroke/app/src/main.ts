import * as THREE from 'three';
import * as E from './engine';
import { QUALITY_TIERS, createScene, type FreeArea, type SceneView } from './scene';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const still = params.has('still');
declare const __BUILD__: string;
{
  const el = document.createElement('div');
  el.id = 'build';
  el.textContent = `版本 ${__BUILD__}`;
  document.body.appendChild(el);
}
// ?pose=intake|compression|power|exhaust|spark stops the engine at a telling moment (screenshots, video)
const POSES: Record<string, number> = { intake: 100, compression: 300, spark: 356, power: 372, exhaust: 640 };
const pose = params.get('pose');

const canvas = $<HTMLCanvasElement>('c');

// --- boot: WebGL 2 check, then the scene; otherwise a still picture --------------------------
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
    return createScene(canvas, () => showFallback('这台设备画不出这个 3D 模型，先看看静态的图和要点吧。'));
  } catch {
    return null;
  }
}
const booted = boot();
if (booted) run(booted);
else showFallback('这台设备暂时显示不了 3D 画面，先看看静态的图和要点吧。');

const SAY: Record<E.Stroke, string> = {
  intake: '进气门打开，活塞向下，吸进汽油和空气',
  compression: '两个气门关闭，活塞向上，压缩混合物',
  power: '火花塞点火，燃气推动活塞向下',
  exhaust: '排气门打开，活塞向上，排出废气',
};

function run(view: SceneView) {
  const landscape = window.matchMedia('(min-aspect-ratio: 1/1)');
  const clamp = THREE.MathUtils.clamp;

  let st = E.initialState();
  let held = false;
  let paused = false;
  let handTarget = 0; // where the finger has turned the crank to
  let handOmega = 0;
  let sparkAt = -9;
  let released = false; // let go by hand, waiting to see whether it catches
  let note = '';
  let noteUntil = 0;
  let cyclesShown = 0;
  let clock = 0;

  if (pose && pose in POSES) {
    st = E.advance(st, POSES[pose]).state;
    if (pose === 'spark') sparkAt = 0.05; // mid-flash (the clock starts at 0)
    paused = true;
  }
  handTarget = st.theta;

  const say = (t: string, secs = 4) => {
    note = t;
    noteUntil = clock + secs;
  };

  // --- panel ---------------------------------------------------------------------------------------
  const hint = $('hint');
  const stepNo = $('stepNo');
  const stepText = $('stepText');
  const out = { angle: $('vAngle'), strokes: $('vStrokes'), turns: $('vTurns'), powers: $('vPowers') };
  const energy = $('energy');
  const energyText = $('energyText');
  const startBtn = $<HTMLButtonElement>('startBtn');
  const strokeKeys = Array.from(document.querySelectorAll<HTMLButtonElement>('#strokes button'));
  if (pose) hint.classList.add('gone');

  const touched = () => hint.classList.add('gone');
  const running = () => st.ignition && !held && !paused && (st.omega > 25 || st.starter > 0);

  strokeKeys.forEach((b) =>
    b.addEventListener('click', () => {
      touched();
      const k = Number(b.dataset.k);
      // jump forward to the start of that stroke, counting everything on the way, and stop there
      const c = E.cycleAngle(st.theta);
      let to = st.theta - c + k * 180;
      if (to < st.theta - 1e-6) to += 720;
      const r = E.advance({ ...st, ignition: true }, to);
      if (r.events.spark) sparkAt = clock;
      st = { ...r.state, omega: 0, starter: 0, ignition: true };
      handTarget = st.theta;
      paused = true;
      released = false;
      say(k === 2 ? '火花塞刚点着，燃气马上推动活塞。转飞轮或点「启动」继续' : '停在这个冲程的开头。转飞轮或点「启动」继续', 3.5);
    }),
  );
  startBtn.addEventListener('click', () => {
    touched();
    if (running()) {
      st = { ...st, ignition: false, starter: 0 };
      say('熄火了：火花塞不再点火，飞轮慢慢停下来');
    } else {
      st = { ...st, ignition: true, starter: 2.5 };
      paused = false;
      released = false;
      say('启动电机带着飞轮转，等火花塞点着……', 2.5);
    }
  });
  $('reset').addEventListener('click', () => {
    st = E.initialState();
    handTarget = 0;
    paused = false;
    released = false;
    cyclesShown = 0;
    noteUntil = 0;
  });

  // part names
  const tagBtn = $('tagToggle');
  let tagsOn = true;
  tagBtn.addEventListener('click', () => {
    tagsOn = !tagsOn;
    tagBtn.setAttribute('aria-pressed', String(tagsOn));
  });
  // a plain overlay rather than <dialog>: older WebViews have no showModal()
  const about = $('about');
  $('aboutBtn').addEventListener('click', () => (about.hidden = false));
  $('aboutClose').addEventListener('click', () => (about.hidden = true));
  about.addEventListener('click', (e) => {
    if (e.target === about) about.hidden = true;
  });

  // --- turning the flywheel by hand: the finger goes round the crank, forward only --------------
  let lastAngle: number | null = null;
  const fingerAngle = (e: PointerEvent) => {
    const c = view.crankOnScreen();
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - c.x;
    const dy = e.clientY - r.top - c.y;
    // too close to the axle to tell which way the finger goes
    return Math.hypot(dx, dy) < 18 ? null : THREE.MathUtils.radToDeg(Math.atan2(dy, dx)); // clockwise on screen is positive
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    touched();
    held = true;
    paused = false;
    released = false;
    st = { ...st, ignition: true, starter: 0 };
    handTarget = st.theta;
    handOmega = st.omega;
    lastAngle = fingerAngle(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!held) return;
    const a = fingerAngle(e);
    if (a !== null && lastAngle !== null) {
      let d = a - lastAngle;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      // the crank only turns forward; turning back does nothing, like a ratchet
      if (d > 0) handTarget = Math.max(handTarget, st.theta) + d;
    }
    lastAngle = a;
  });
  const endDrag = () => {
    if (!held) return;
    held = false;
    canvas.classList.remove('dragging');
    st = { ...st, omega: clamp(handOmega, 0, 700) };
    released = true;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown') return;
    touched();
    paused = false;
    const r = E.advance({ ...st, ignition: true }, st.theta + 10);
    if (r.events.spark) sparkAt = clock;
    st = { ...r.state, omega: 0 };
    handTarget = st.theta;
  });

  // --- layout ----------------------------------------------------------------------------------------
  const dock = $('dock');
  const header = document.querySelector<HTMLElement>('.top')!;
  const chip = $('tagToggle');
  // the spark plug's name sits above the engine's highest point, so leave it room under the title
  const PLUG_TAG = 26;
  function layout() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const t = header.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    // ?still hides the header and panel, so the engine gets the whole canvas
    const free: FreeArea = still
      ? { top: 56, bottom: 24, left: 24, right: 24 }
      : landscape.matches
        ? { top: t.bottom + 8, bottom: 8, left: 8, right: W - d.left + 12 }
        : { top: t.bottom + 6 + PLUG_TAG, bottom: H - d.top + 4, left: 0, right: 0 };
    view.resize(W, H, free);
    // portrait: the chip sits just above the panel, anchored by its bottom edge
    chip.style.top = '';
    chip.style.bottom = landscape.matches ? '' : `${H - d.top + 12}px`;
  }
  window.addEventListener('resize', layout);
  layout();

  // --- loop ------------------------------------------------------------------------------------------
  const tags = {
    intake: $('tagIntake'),
    exhaust: $('tagExhaust'),
    plug: $('tagPlug'),
    piston: $('tagPiston'),
    crank: $('tagCrank'),
    flywheel: $('tagFly'),
  };
  const proj = new THREE.Vector3();
  const pinned = params.get('tier');
  let tier = pinned === null ? 1 : clamp(Number(pinned) || 0, 0, QUALITY_TIERS - 1);
  let mayRise = pinned === null;
  view.setQuality(tier);
  const statsEl = params.has('stats') ? document.body.appendChild(document.createElement('div')) : null;
  if (statsEl) statsEl.style.cssText = 'position:fixed;left:8px;bottom:4px;font:11px monospace;color:#c00;z-index:9';
  if (still) document.body.classList.add('still');
  let last = 0;
  let rafId = 0;
  let loopOn = false;
  let slowTime = 0;
  let busyTime = 0;
  let sampleTime = 0;
  let warmUp = 0;
  let statsTick = 0;
  function startLoop() {
    if (loopOn || halted) return;
    loopOn = true;
    last = 0;
    slowTime = busyTime = sampleTime = 0;
    warmUp = 1;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    loopOn = false;
    cancelAnimationFrame(rafId);
  }
  // same tier watch as the buoyancy lab: start one below the best, climb once with room to spare,
  // step down while slow, and fall back to the still picture below ~12 fps at the lowest tier
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

  let layoutCheck = 0;
  let layoutKey = '';
  let shownKey = '';
  function frame(now: number) {
    if (!loopOn || halted) return;
    rafId = requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    watch(raw);
    const dt = Math.min(raw, 1 / 20);
    clock += dt;

    // move the engine
    let events: E.Events = { spark: false, power: false, cycleDone: false };
    if (held) {
      const from = st.theta;
      const to = from + (Math.max(handTarget, from) - from) * Math.min(1, dt * 18);
      const r = E.advance(st, to);
      st = r.state;
      events = r.events;
      handOmega += ((to - from) / dt - handOmega) * Math.min(1, dt * 10);
    } else if (!paused) {
      const r = E.step(st, dt);
      st = r.state;
      events = r.events;
    }
    if (events.spark) sparkAt = clock;
    if (events.power && released) {
      released = false;
      say('它自己转起来了！做功冲程推一下，另外三个冲程靠飞轮惯性', 5);
    }
    if (released && st.omega === 0) {
      released = false;
      say('转得太慢，没能自己转起来。再用力甩一下', 4);
    }
    if (events.cycleDone && cyclesShown < 1 && (held || running())) {
      cyclesShown++;
      say('走完 1 个循环：4 个冲程，曲轴转 2 圈，做功 1 次', 4.5);
    }

    view.update({ theta: st.theta, burnt: st.burnt, sparkAge: clock - sparkAt, time: clock });
    view.render();

    // readings
    const r = E.readings(st);
    const k = E.strokeIndex(st.theta);
    const sentence = clock < noteUntil ? note : SAY[r.stroke];
    const live = running();
    const powerNow = r.stroke === 'power' && st.burnt;
    const key = `${k}|${sentence}|${Math.floor(r.angle)}|${r.strokes}|${r.turns.toFixed(1)}|${r.powers}|${live}|${powerNow}`;
    if (key !== shownKey) {
      shownKey = key;
      stepNo.textContent = String(k + 1);
      stepText.textContent = sentence;
      strokeKeys.forEach((b, i) => b.classList.toggle('on', i === k));
      out.angle.textContent = `${Math.floor(r.angle)}°`;
      out.strokes.textContent = String(r.strokes);
      out.turns.textContent = r.turns.toFixed(1);
      out.powers.textContent = String(r.powers);
      energyText.textContent =
        r.stroke === 'compression'
          ? '机械能 → 内能'
          : r.stroke === 'power'
            ? st.burnt
              ? '内能 → 机械能'
              : '没点火，不做功'
            : '靠飞轮惯性';
      energy.classList.toggle('ok', powerNow);
      startBtn.textContent = live ? '熄火' : '启动';
    }

    // the panel can grow after the first layout (fonts, step text): keep the chip above it
    if (++layoutCheck % 15 === 0) {
      const lk = `${dock.offsetTop}|${dock.offsetHeight}|${header.offsetTop + header.offsetHeight}|${chip.offsetHeight}`;
      if (lk !== layoutKey) {
        layoutKey = lk;
        layout();
      }
    }
    const a = view.anchors();
    const lift = E.valveLift(st.theta);
    placeTag(tags.intake, a.intake, 0, -1, lift.intake > 0.02 ? '进气门 开' : '进气门 关', lift.intake > 0.02);
    placeTag(tags.exhaust, a.exhaust, 0, -1, lift.exhaust > 0.02 ? '排气门 开' : '排气门 关', lift.exhaust > 0.02);
    placeTag(tags.plug, a.plug, 0, -1, '火花塞', clock - sparkAt < 0.4);
    placeTag(tags.piston, a.piston, -1, 0, '活塞', false);
    placeTag(tags.crank, a.crank, -1, 0, '曲轴', false);
    placeTag(tags.flywheel, a.flywheel, 1, 0, '飞轮', false);
    if (statsEl && (statsTick += raw) > 0.5) {
      statsTick = 0;
      const i = view.info();
      statsEl.textContent = `tier ${tier} · ${i.calls} calls · ${i.triangles} tris · dpr ${i.dpr.toFixed(2)}`;
    }
  }

  /** Pin a label next to an anchor; sx/sy pick the side (-1, 0, 1). Dark while that part is acting. */
  function placeTag(el: HTMLElement, p: THREE.Vector3, sx: number, sy: number, text: string, active: boolean) {
    proj.copy(p).project(view.camera);
    const x = (proj.x * 0.5 + 0.5) * canvas.clientWidth + sx * 6;
    const y = (-proj.y * 0.5 + 0.5) * canvas.clientHeight + sy * 6;
    el.style.transform = `translate(${x}px, ${y}px) translate(${-50 + sx * 50}%, ${-50 + sy * 50}%)`;
    el.style.opacity = tagsOn ? '1' : '0';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('on', active);
  }

  startLoop();
}
