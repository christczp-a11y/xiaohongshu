import * as THREE from 'three';
import { DEFAULT_SETUP, display, initialState, readings, settle, step, type State } from './physics';
import { createScene, type FreeArea } from './scene';
import { TITLE_FONT } from './textures';

const S = DEFAULT_SETUP;
const START_BOTTOM = 13; // cube bottom above the cup floor, just clear of the water
const MIN_BOTTOM = 1; // never let it rest on the floor (the scale would read wrong)
const MAX_BOTTOM = 13;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  // the canvas textures (nameplate) draw with the title font, so load it first
  try {
    await document.fonts.load(`32px ${TITLE_FONT}`, '浮力');
  } catch {
    // fall back to the system font
  }

  const canvas = $<HTMLCanvasElement>('c');
  const view = createScene(canvas, S);
  const landscape = window.matchMedia('(min-aspect-ratio: 1/1)');

  // ?pose=air|half|full holds the rig in a fixed state (for screenshots and checks)
  const pose = new URLSearchParams(location.search).get('pose');
  const posed = (bottom: number): State => settle(initialState(S, bottom), S);
  let target = pose === 'full' ? 3.5 : pose === 'half' ? S.spoutHeight - S.cubeSide / 2 : START_BOTTOM;
  let state = pose ? posed(target) : initialState(S, START_BOTTOM);
  let overflowing = false;
  if (pose) $('hint').classList.add('gone');

  // --- drag to raise / lower -------------------------------------------------------
  let dragY: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    $('hint').classList.add('gone');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    target -= (e.clientY - dragY) * view.cmPerPixel();
    target = THREE.MathUtils.clamp(target, MIN_BOTTOM, MAX_BOTTOM);
    dragY = e.clientY;
  });
  const endDrag = () => {
    dragY = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') target = Math.max(MIN_BOTTOM, target - 0.5);
    if (e.key === 'ArrowUp') target = Math.min(MAX_BOTTOM, target + 0.5);
  });

  // --- controls -------------------------------------------------------------------------
  const arrowBtn = $('arrowToggle');
  let arrowsOn = true;
  arrowBtn.addEventListener('click', () => {
    arrowsOn = !arrowsOn;
    arrowBtn.setAttribute('aria-pressed', String(arrowsOn));
    view.setArrows(arrowsOn);
  });
  $('reset').addEventListener('click', () => {
    state = initialState(S, START_BOTTOM);
    target = START_BOTTOM;
  });
  $('aboutBtn').addEventListener('click', () => $<HTMLDialogElement>('about').showModal());
  const stepNo = $('stepNo');
  const stepText = $('stepText');
  let noteUntil = 0;
  $('record').addEventListener('click', () => {
    // the data table is not built yet; say so instead of pretending
    noteUntil = performance.now() + 2500;
    stepText.textContent = '记录表还在做，先把这组数字记在本子上吧';
  });

  // --- layout -----------------------------------------------------------------------------
  const dock = $('dock');
  const tabs = $('tabs');
  const insetEl = $('inset');
  const hint = $('hint');
  const chip = $('arrowToggle');
  function layout() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const t = tabs.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const free: FreeArea = landscape.matches
      ? { top: t.bottom + 8, bottom: 8, left: 8, right: W - d.left + 12 }
      : { top: t.bottom + 10, bottom: H - d.top + 4, left: 0, right: 0 };
    view.resize(W, H, free);
    const r = insetEl.getBoundingClientRect();
    const b = insetEl.clientLeft;
    view.setInset({ x: r.left + b, y: r.top + b, w: r.width - 2 * b, h: r.height - 2 * b });
    hint.style.bottom = landscape.matches ? '24px' : `${H - d.top + 18}px`;
    chip.style.top = landscape.matches ? '' : `${d.top - chip.offsetHeight - 14}px`;
  }
  window.addEventListener('resize', layout);
  layout();

  // --- loop ---------------------------------------------------------------------------------
  const tags = { G: $('lblG'), Fb: $('lblB'), Ft: $('lblT') };
  const out = { G: $('vG'), F: $('vF'), B: $('vB'), P: $('vP') };
  const eqrow = $('eqrow');
  const eqSign = $('eqSign');
  const eqNote = $('eqNote');
  const proj = new THREE.Vector3();

  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    // ease toward the finger so motion feels weighty, not twitchy
    const cubeBottom = state.cubeBottom + (target - state.cubeBottom) * Math.min(1, dt * 14);
    const before = state.beakerWater;
    state = step(state, cubeBottom, dt, S);
    overflowing = state.beakerWater - before > 1e-4;

    const r = readings(state, S);
    view.update(r, state.cubeBottom, state.beakerWater, overflowing, now / 1000);
    view.render(now / 1000);

    const d = display(r);
    out.G.textContent = d.weight;
    out.F.textContent = d.scaleReading;
    out.B.textContent = d.buoyancy;
    out.P.textContent = d.beakerWeight;
    const inWater = r.buoyancy > 0.01;
    const full = r.submerged >= S.cubeSide - 1e-3;
    const match = d.buoyancy === d.beakerWeight && inWater && !overflowing;
    eqrow.classList.toggle('ok', match);
    eqSign.textContent = match ? '=' : inWater ? '…' : '?';
    eqNote.textContent = match
      ? '阿基米德原理'
      : inWater
        ? overflowing ? '水正在流进小烧杯' : '烧杯里有之前溢出的水，点「重做」再来'
        : '把铝块放进水里看看';

    if (now > noteUntil) {
      const [n, text] = !inWater
        ? ['1', '先读测力计：铝块在空气中有多重？']
        : !full
          ? ['2', '慢慢往下放，盯着测力计的指针']
          : overflowing
            ? ['3', '全部浸没了，等溢出的水流完']
            : ['4', '比一比：浮力和溢出的水重'];
      stepNo.textContent = n;
      stepText.textContent = text;
    }

    const a = view.anchors();
    placeTag(tags.G, a.G, 0, 1, `G ${d.weight}N`, arrowsOn);
    placeTag(tags.Fb, a.Fb, -1, 0, `F浮 ${d.buoyancy}N`, arrowsOn && inWater);
    placeTag(tags.Ft, a.Ft, 1, 0, `F拉 ${d.scaleReading}N`, arrowsOn);

    requestAnimationFrame(frame);
  }

  /** Pin a label next to an arrow tip; sx/sy pick the side (-1, 0, 1). */
  function placeTag(el: HTMLElement, p: THREE.Vector3, sx: number, sy: number, text: string, visible: boolean) {
    proj.copy(p).project(view.camera);
    const x = (proj.x * 0.5 + 0.5) * canvas.clientWidth + sx * 8;
    const y = (-proj.y * 0.5 + 0.5) * canvas.clientHeight + sy * 10;
    el.style.transform = `translate(${x}px, ${y}px) translate(${-50 + sx * 50}%, ${-50 + sy * 50}%)`;
    el.style.opacity = visible ? '1' : '0';
    if (el.textContent !== text) el.textContent = text;
  }

  requestAnimationFrame(frame);
}

main();
