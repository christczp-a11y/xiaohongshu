// Scene C (浮还是沉): let go of a solid cube above a cup of liquid and let
// gravity, buoyancy and drag move it until it floats or rests on the floor.
// Same units as physics.ts. The cup is filled below the spout, so nothing
// overflows and the liquid volume never changes.

import { CM3, cupArea, submergedDepth, waterLevel, type Setup } from './physics';

export const FLOAT_FILL = 9; // liquid depth before the cube goes in, cm

export interface FloatState {
  cupWater: number;
  y: number; // cube bottom above the cup floor
  v: number; // cm/s, up is positive
  held: boolean;
}

export interface FloatReadings {
  level: number;
  submerged: number;
  weight: number; // G
  buoyancy: number; // F浮
  support: number; // F支 from the cup floor
  resting: boolean; // still, and either floating or on the floor
}

const CD = 1.05; // drag coefficient of a cube moving face-first
const LINEAR = 0.006; // N per cm/s at full immersion, so small bobs die out

export function floatStart(s: Setup, y: number): FloatState {
  return { cupWater: cupArea(s) * FLOAT_FILL, y, v: 0, held: true };
}

function forces(cupWater: number, y: number, s: Setup) {
  const a = s.cubeSide;
  const level = waterLevel(cupWater, y, s);
  const submerged = submergedDepth(level, y, a);
  const weight = s.cubeDensity * a ** 3 * CM3 * s.g;
  const buoyancy = s.liquidDensity * a * a * submerged * CM3 * s.g;
  return { level, submerged, weight, buoyancy };
}

export function floatStep(st: FloatState, dt: number, s: Setup): FloatState {
  if (st.held) return { ...st, v: 0 };
  const a = s.cubeSide;
  const mass = s.cubeDensity * a ** 3 * CM3; // kg
  const area = (a / 100) ** 2; // m²
  let { y, v } = st;
  const n = 8;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const f = forces(st.cupWater, y, s);
    const frac = f.submerged / a;
    const vm = v / 100; // m/s
    const drag = frac * (0.5 * s.liquidDensity * CD * area * vm * Math.abs(vm) + LINEAR * v);
    // liquid dragged along with the cube adds inertia, which keeps light
    // blocks from bouncing unrealistically
    const inertia = mass + 0.5 * s.liquidDensity * a ** 3 * CM3 * frac;
    const acc = ((f.buoyancy - f.weight - drag) / inertia) * 100; // cm/s²
    v += acc * h;
    y += v * h;
    if (y <= 0) {
      y = 0;
      if (v < 0) v = 0;
    }
  }
  return { ...st, y, v };
}

export function floatReadings(st: FloatState, s: Setup): FloatReadings {
  const f = forces(st.cupWater, st.y, s);
  const onFloor = !st.held && st.y <= 1e-6;
  const support = onFloor ? Math.max(0, f.weight - f.buoyancy) : 0;
  const net = f.buoyancy + support - f.weight;
  return { ...f, support, resting: !st.held && Math.abs(st.v) < 0.3 && Math.abs(net) < 0.004 };
}

export type Outcome = 'float' | 'suspend' | 'sink';

/** Where a solid cube ends up, from the density comparison. */
export function outcome(s: Setup): Outcome {
  if (Math.abs(s.cubeDensity - s.liquidDensity) < 1e-9) return 'suspend';
  return s.cubeDensity < s.liquidDensity ? 'float' : 'sink';
}
