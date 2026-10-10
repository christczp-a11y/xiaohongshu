// Procedural landscape for the diorama: mountains at the back, a lake at the front right,
// a river running from the mountains into the lake. Pure functions, no three.js.

export function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const HALF = 5;                         // half width of the land block
export const LAKE = { x: 1.5, z: 1.9 }, LAKE_R = 2.5;
export const WL_MIN = -0.25, WL_MAX = 0.28;    // lake surface height range
export const BOTTOM = -1.6;                    // bottom of the cut-away section
export const RIVER: [number, number][] = [[-0.7, -2.7], [-0.9, -1.7], [-0.5, -0.8], [-0.1, 0.0], [0.5, 0.8], [1.0, 1.4]];
const PEAKS: [number, number, number, number][] = [[-2.6, -3.3, 3.0, 1.25], [1.4, -3.7, 2.5, 1.15], [3.7, -2.6, 1.9, 1.1], [-4.0, -1.0, 1.2, 1.1]];

export function distRiver(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function heightAt(x: number, z: number): number {
  let h = 0.55 + (fbm(x * 0.35 + 3, z * 0.35 + 7) - 0.5) * 0.45;
  let mount = 0;
  for (const [px, pz, ph, s] of PEAKS) {
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    mount += ph * Math.exp(-d2 / (2 * s * s));
  }
  h += mount * (0.75 + 0.5 * fbm(x * 1.3, z * 1.3)) + Math.min(mount, 1) * 0.35 * (fbm(x * 3.1 + 11, z * 3.1) - 0.5);
  h -= 1.0 * (1 - smooth(0.6, 2.3, Math.hypot(x - LAKE.x, z - LAKE.z)));
  h -= 0.28 * (1 - smooth(0.05, 0.42, distRiver(x, z)));
  return h;
}

export const inLakeDisc = (x: number, z: number): boolean => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE_R;
