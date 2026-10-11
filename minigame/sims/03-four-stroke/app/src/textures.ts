import * as THREE from 'three';

// Every texture is drawn at startup, so the package ships no image files.

export const SANS = '-apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Microsoft YaHei", sans-serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Seeded 2D value noise in [0, 1]. */
function valueNoise(seed: number) {
  const rnd = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const X = xi & 255;
    const Y = yi & 255;
    const a = vals[perm[X + perm[Y]]];
    const b = vals[perm[X + 1 + perm[Y]]];
    const c = vals[perm[X + perm[Y + 1]]];
    const d = vals[perm[X + 1 + perm[Y + 1]]];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/** Light maple for the wooden block: fine grain running along u, one face per texture. */
export function maple(size = 512): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const n1 = valueNoise(11);
  const n2 = valueNoise(23);
  const n3 = valueNoise(37);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * 4.5; // the face is 4.5 cm
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 4.5;
      const ring = v * 3.2 + n1(u * 0.3, v * 1.2) * 2.2 + n2(u * 1.4, v * 3) * 0.3;
      const f = ring - Math.floor(ring);
      const late = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 12);
      const pores = n3(u * 2, v * 60) * 0.5;
      const k = 1 - late * 0.22 - pores * 0.08;
      const i = (y * size + x) * 4;
      img.data[i] = 222 * k;
      img.data[i + 1] = 190 * k;
      img.data[i + 2] = 146 * k;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

/** Fine speckle for painted cast iron (used as a bump map). */
export function speckle(size = 256, seed = 5): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const n = valueNoise(seed);
  const rnd = rng(seed + 1);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const v = n(x * 0.15, y * 0.15) * 0.6 + rnd() * 0.4;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Brushed-metal roughness: fine streaks along u. */
export function brushed(size = 256, base = 0.32, amount = 1): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const n = valueNoise(3);
  const rnd = rng(9);
  for (let y = 0; y < size; y++) {
    const row = (rnd() - 0.5) * 0.12 * amount;
    for (let x = 0; x < size; x++) {
      const v = base + row + (n(x * 0.02, y * 1.7) - 0.5) * 0.14 * amount;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(1, v)) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Roughness for glass: mostly polished, with faint handling smudges. */
export function smudge(size = 256): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const n = valueNoise(41);
  const m = valueNoise(43);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const blot = Math.max(0, n(x * 0.03, y * 0.03) - 0.62) * 2.2 * m(x * 0.12, y * 0.12);
      const v = 0.035 + blot * 0.25;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(1, v) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface DialSpec {
  width: number; // plate size, cm
  height: number;
  top: number; // plate top edge in the scale's local y
  p0: number; // local y of the 0 N mark
  k: number; // cm per newton
  max: number; // newtons
}

/** Printed scale plate of a 0–5 N spring scale, with the slot the spring runs in. */
export function dialPlate(s: DialSpec): THREE.CanvasTexture {
  const ppc = 110;
  const W = Math.round(s.width * ppc);
  const H = Math.round(s.height * ppc);
  const [c, g] = canvas(W, H);
  g.fillStyle = '#f7f7f5';
  g.fillRect(0, 0, W, H);
  const rnd = rng(17);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(60,60,60,${rnd() * 0.035})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const yOf = (v: number) => (s.top - (s.p0 - v * s.k)) * ppc;
  const cx = W / 2;
  const slot = 0.62 * ppc;
  const y0 = yOf(0);
  const yMax = yOf(s.max);
  // the slot the spring and pointer ride in
  g.fillStyle = '#26272a';
  roundRect(g, cx - slot / 2, y0 - 1.1 * ppc, slot, yMax - y0 + 2.2 * ppc, slot / 2);
  g.fill();
  // ticks every 0.2 N on both sides, longer every 0.5 N and 1 N
  g.strokeStyle = '#1d1d1f';
  g.fillStyle = '#1d1d1f';
  const steps = Math.round(s.max / 0.2);
  for (let j = 0; j <= steps; j++) {
    const y = yOf(j * 0.2);
    const whole = j % 5 === 0;
    const half = !whole && (j * 0.2) % 0.5 < 1e-6;
    const len = (whole ? 0.95 : half ? 0.7 : 0.45) * ppc;
    g.lineWidth = whole ? 4.5 : 2.5;
    const gap = slot / 2 + 0.12 * ppc;
    g.beginPath();
    g.moveTo(cx - gap, y);
    g.lineTo(cx - gap - len, y);
    g.moveTo(cx + gap, y);
    g.lineTo(cx + gap + len, y);
    g.stroke();
  }
  g.font = `600 ${Math.round(0.5 * ppc)}px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  for (let v = 0; v <= s.max; v++) g.fillText(String(v), cx - slot / 2 - 1.15 * ppc, yOf(v) + 2);
  g.textAlign = 'left';
  for (let v = 0; v <= s.max; v++) g.fillText(String(v), cx + slot / 2 + 1.15 * ppc, yOf(v) + 2);
  g.font = `600 ${Math.round(0.45 * ppc)}px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('N', cx, yMax + 1.6 * ppc);
  return toTexture(c);
}

/** Printed graduations for a beaker, 0 at the inner floor. */
export function beakerMarks(heightCm: number, mlPerCm: number, maxMl: number): THREE.CanvasTexture {
  const ppc = 128;
  const W = 256;
  const H = Math.round(heightCm * ppc);
  const [c, g] = canvas(W, H);
  g.strokeStyle = '#2a2a2c';
  g.fillStyle = '#2a2a2c';
  g.font = `600 ${Math.round(0.42 * ppc)}px ${SANS}`;
  g.textBaseline = 'middle';
  for (let ml = 50; ml <= maxMl; ml += 50) {
    const y = H - (ml / mlPerCm) * ppc;
    const major = ml % 100 === 0;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(major ? 150 : 110, y);
    g.stroke();
    if (major) g.fillText(String(ml), 160, y);
  }
  g.font = `600 ${Math.round(0.36 * ppc)}px ${SANS}`;
  g.fillText('mL', 160, H - (maxMl / mlPerCm) * ppc - 0.6 * ppc);
  return toTexture(c);
}

/** Tileable ripple normal map from a few summed sine waves. */
export function ripple(): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const waves = [
    [1, 2, 0.6],
    [3, -1, 0.35],
    [-2, 3, 0.25],
    [5, 4, 0.12],
    [-7, 5, 0.06],
  ];
  const n = new THREE.Vector3();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, amp] of waves) {
        const ph = ((kx * x + ky * y) / N) * Math.PI * 2;
        dx += amp * kx * Math.cos(ph);
        dy += amp * ky * Math.cos(ph);
      }
      n.set(-dx * 0.06, -dy * 0.06, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Soft blob for contact shadows: dark centre fading to clear. */
function blobCanvas(shape: 'round' | 'rect' | 'ring', inner = 0.55): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvas(S, S);
  if (shape === 'round') {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(inner, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  } else if (shape === 'ring') {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.25)');
    grad.addColorStop(inner - 0.08, 'rgba(0,0,0,0.35)');
    grad.addColorStop(inner, 'rgba(0,0,0,1)');
    grad.addColorStop(inner + 0.12, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  } else {
    // blurred rectangle: draw it off-canvas and keep only its shadow
    const pad = S * 0.18;
    g.shadowColor = 'rgba(0,0,0,1)';
    g.shadowBlur = pad * 0.9;
    g.shadowOffsetX = S * 4;
    g.fillStyle = '#000';
    g.fillRect(pad - S * 4, pad, S - pad * 2, S - pad * 2);
  }
  return c;
}

/** Faint shadow a glass cylinder throws: a soft capsule with darker rims. */
function glassShadowCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = 92;
  const x0 = 128;
  const x1 = 384;
  g.shadowColor = 'rgba(0,0,0,1)';
  g.shadowBlur = 26;
  g.shadowOffsetY = H * 3;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(x0, H / 2 - H * 3, r, Math.PI / 2, (Math.PI * 3) / 2);
  g.arc(x1, H / 2 - H * 3, r * 0.94, -Math.PI / 2, Math.PI / 2);
  g.closePath();
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.beginPath();
  g.moveTo(x0, H / 2 - r - H * 3);
  g.lineTo(x1, H / 2 - r * 0.94 - H * 3);
  g.moveTo(x0, H / 2 + r - H * 3);
  g.lineTo(x1, H / 2 + r * 0.94 - H * 3);
  g.stroke();
  return c;
}

export interface ShadowItem {
  shape: 'round' | 'rect' | 'ring' | 'glass';
  x: number; // centre, world cm
  z: number;
  w: number; // footprint along the item's own x and z, cm
  d: number;
  yaw?: number; // rotation about +y, as Object3D.rotation.y
  alpha: number;
  inner?: number;
}

/**
 * Contact shadows that never move, baked into one texture for a horizontal
 * rectangle of the world (x0..x0+w, z0..z0+d), so they cost one draw call.
 */
export function shadowSheet(x0: number, z0: number, w: number, d: number, ppc: number, items: ShadowItem[]): THREE.CanvasTexture {
  const [c, g] = canvas(Math.round(w * ppc), Math.round(d * ppc));
  const cache = new Map<string, HTMLCanvasElement>();
  for (const it of items) {
    const key = `${it.shape}|${it.inner ?? 0.55}`;
    let src = cache.get(key);
    if (!src) {
      src = it.shape === 'glass' ? glassShadowCanvas() : blobCanvas(it.shape, it.inner);
      cache.set(key, src);
    }
    g.save();
    g.globalAlpha = it.alpha;
    g.translate((it.x - x0) * ppc, (it.z - z0) * ppc);
    g.rotate(-(it.yaw ?? 0)); // canvas y runs along world +z
    g.drawImage(src, (-it.w / 2) * ppc, (-it.d / 2) * ppc, it.w * ppc, it.d * ppc);
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
