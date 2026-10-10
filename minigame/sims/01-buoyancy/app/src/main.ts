import * as THREE from 'three';
import { DEFAULT_SETUP, display, initialState, readings, step } from './physics';
import { createScene } from './scene';

const S = DEFAULT_SETUP;
const START_BOTTOM = 18; // cube bottom above the cup floor, hanging in air
const MIN_BOTTOM = 1; // never let it rest on the floor (the scale would read wrong)
const MAX_BOTTOM = 20;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const stage = $('stage');
const view = createScene(canvas, S);

let state = initialState(S, START_BOTTOM);
let target = START_BOTTOM;
let overflowing = false;

// --- drag to raise / lower -------------------------------------------------
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

// --- controls ----------------------------------------------------------------
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

const fb = $('fb');
document.querySelectorAll<HTMLButtonElement>('.opts button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.opts button').forEach((x) => x.classList.remove('right', 'wrong'));
    const ok = b.dataset.a === 'same';
    b.classList.add(ok ? 'right' : 'wrong');
    fb.textContent = ok
      ? '对！浸没以后排开水的体积不变，浮力就不变。拖下去看看测力计的指针。'
      : '再想想：浸没以后，铝块排开的水还会变多吗？拖下去，盯着测力计的指针试试。';
    fb.classList.add('show');
  });
});

// --- loop ----------------------------------------------------------------------
const lblG = $('lblG');
const lblB = $('lblB');
const out = { G: $('vG'), F: $('vF'), B: $('vB'), P: $('vP') };
const eqrow = $('eqrow');
const eqSign = $('eqSign');
const eqNote = $('eqNote');
const proj = new THREE.Vector3();

function resize() {
  const r = stage.getBoundingClientRect();
  view.resize(r.width, r.height);
}
window.addEventListener('resize', resize);
resize();

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
  view.render();

  const d = display(r);
  out.G.textContent = d.weight;
  out.F.textContent = d.scaleReading;
  out.B.textContent = d.buoyancy;
  out.P.textContent = d.beakerWeight;
  const match = d.buoyancy === d.beakerWeight && r.buoyancy > 0.01 && !overflowing;
  eqrow.classList.toggle('ok', match);
  eqSign.textContent = match ? '=' : r.buoyancy > 0.01 ? '…' : '?';
  eqNote.textContent = match
    ? '阿基米德原理'
    : r.buoyancy > 0.01
      ? overflowing ? '水正在流进小桶' : '小桶里有之前溢出的水，点「重做」再来'
      : '把铝块放进水里看看';

  // HTML labels next to the arrows
  const { cube } = view.anchors();
  placeLabel(lblG, proj.copy(cube).add(new THREE.Vector3(-1.6, -r.weight * 2.2 + 0.4, 3)), arrowsOn);
  placeLabel(lblB, proj.copy(cube).add(new THREE.Vector3(1.6, r.buoyancy * 2.2, 3)), arrowsOn && r.buoyancy > 0.01);

  requestAnimationFrame(frame);
}

function placeLabel(el: HTMLElement, p: THREE.Vector3, visible: boolean) {
  p.project(view.camera);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  el.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
  el.style.opacity = visible ? '1' : '0';
}

requestAnimationFrame(frame);
