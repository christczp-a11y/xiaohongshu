// A single-cylinder four-stroke petrol engine, turned by hand or running on its own.
// Angles are crank degrees, counted up from 0 at top dead centre at the start of an intake
// stroke; one working cycle is 720°. Lengths are model centimetres (not to scale).
// Gas forces are only there to make the flywheel speed up in the power stroke and slow down
// in compression; the readings never show them, so the units are arbitrary.

export const CRANK_R = 4; // half the stroke
export const ROD_L = 14;
export const STROKE = 2 * CRANK_R;
export const CLEARANCE = 1.6; // gas height left above the piston at the top, roof included

export const STROKES = ['intake', 'compression', 'power', 'exhaust'] as const;
export type Stroke = (typeof STROKES)[number];
export const STROKE_NAMES: Record<Stroke, string> = { intake: '吸气', compression: '压缩', power: '做功', exhaust: '排气' };

/** Petrol engines are lit by a spark plug; diesels have an injector and light by compression. */
export type Kind = 'petrol' | 'diesel';

/**
 * Where the spark plug fires, or the diesel's injector sprays: just before the top at the end
 * of compression, as engines turning slowly do.
 */
export const SPARK_AT = 355;
const BURN_END = 380; // the charge has burnt through by here

const RAD = Math.PI / 180;
const GAMMA = 1.3;
const BURN_GAIN = 3.2; // pressure rise from burning, over the compressed charge

/** Angle within the working cycle, 0 ≤ c < 720. */
export function cycleAngle(theta: number): number {
  const c = theta % 720;
  return c < 0 ? c + 720 : c;
}

export function strokeIndex(theta: number): number {
  return Math.min(3, Math.floor(cycleAngle(theta) / 180));
}

export function strokeOf(theta: number): Stroke {
  return STROKES[strokeIndex(theta)];
}

/** Height of the piston pin above the crank centre. */
export function pinHeight(theta: number): number {
  const a = theta * RAD;
  const s = CRANK_R * Math.sin(a);
  return CRANK_R * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - s * s);
}

/** How far the piston is below the top, 0 at the top and STROKE at the bottom. */
export function pistonDrop(theta: number): number {
  return CRANK_R + ROD_L - pinHeight(theta);
}

/** d(pin height)/d(crank angle in radians). */
export function pinSpeed(theta: number): number {
  const a = theta * RAD;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return -CRANK_R * s - (CRANK_R * CRANK_R * s * c) / Math.sqrt(ROD_L * ROD_L - CRANK_R * CRANK_R * s * s);
}

/** Valve openings, 0 shut to 1 fully open: each valve is open through its own stroke only (the textbook timing). */
export function valveLift(theta: number): { intake: number; exhaust: number } {
  const c = cycleAngle(theta);
  const bump = (from: number) => {
    const u = (c - from) / 180;
    return u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 1.4 : 0;
  };
  return { intake: bump(0), exhaust: bump(540) };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much of the charge has burnt, if the plug fired this cycle. */
export function burnFraction(theta: number, burnt: boolean): number {
  if (!burnt) return 0;
  const c = cycleAngle(theta);
  return c >= SPARK_AT ? smooth(SPARK_AT, BURN_END, c) : 0;
}

/** Gauge pressure in the cylinder (atmospheres, roughly). */
export function gasPressure(theta: number, burnt: boolean): number {
  const c = cycleAngle(theta);
  if (c < 180 || c >= 540) return 0; // a valve is open
  const v = (CLEARANCE + pistonDrop(theta)) / (CLEARANCE + STROKE);
  const squeezed = Math.pow(1 / v, GAMMA) - 1; // the trapped charge as an air spring
  const f = burnFraction(theta, burnt);
  if (f <= 0) return squeezed;
  const top = CLEARANCE / (CLEARANCE + STROKE);
  const burning = BURN_GAIN * Math.pow(1 / top, GAMMA) * Math.pow(top / v, GAMMA) - 1;
  return squeezed + (burning - squeezed) * f;
}

/** Turning effect of the gas on the crank: positive drives it forward. */
export function gasTorque(theta: number, burnt: boolean): number {
  return -gasPressure(theta, burnt) * pinSpeed(theta);
}

// --- running the engine -------------------------------------------------------------------------------

export interface EngineState {
  theta: number; // crank angle since the start, degrees
  omega: number; // degrees per second, never negative (the crank only turns forward)
  burnt: boolean; // the plug has fired in this cycle
  powers: number; // power strokes so far
  ignition: boolean;
  starter: number; // seconds of starter motor left
}

export interface Events {
  spark: boolean;
  power: boolean;
  cycleDone: boolean;
}

// tuned so the engine idles at about one working cycle every 3.3 s, slowing visibly as it
// squeezes the charge and picking up after each power stroke
const INERTIA = 1;
const GAS_K = 6;
const DRAG = 0.08; // per second
const RUB = 6; // deg/s² of dry friction
const STARTER_SPEED = 260;
const MAX_OMEGA = 900;

export function initialState(): EngineState {
  return { theta: 0, omega: 0, burnt: false, powers: 0, ignition: true, starter: 0 };
}

/**
 * Move the crank forward to `to`, firing the plug and counting power strokes on the way.
 * Used for both hand turning and running; jumps between strokes go through here too, so the
 * counts always agree with the angle.
 */
export function advance(s: EngineState, to: number): { state: EngineState; events: Events } {
  const ev: Events = { spark: false, power: false, cycleDone: false };
  if (to <= s.theta) return { state: s, events: ev };
  let { burnt, powers } = s;
  let from = s.theta;
  for (;;) {
    const base = Math.floor(from / 720) * 720;
    const m = [base + SPARK_AT, base + 360, base + 720].find((x) => x > from);
    if (m === undefined || m > to) break;
    if (m === base + SPARK_AT) {
      if (s.ignition) {
        burnt = true;
        ev.spark = true;
      }
    } else if (m === base + 360) {
      if (burnt) {
        powers += 1;
        ev.power = true;
      }
    } else {
      burnt = false; // a fresh charge comes in next
      ev.cycleDone = true;
    }
    from = m;
  }
  return { state: { ...s, theta: to, burnt, powers }, events: ev };
}

/** One time step of the free-running crank (not held by a hand). */
export function step(s: EngineState, dt: number): { state: EngineState; events: Events } {
  let omega = s.omega;
  let starter = Math.max(0, s.starter - dt);
  // a few small steps, so the hard push at the top of the power stroke stays smooth
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  let theta = s.theta;
  let burnt = s.burnt;
  const events: Events = { spark: false, power: false, cycleDone: false };
  let st: EngineState = s;
  for (let i = 0; i < n; i++) {
    let acc = (GAS_K * gasTorque(theta, burnt)) / INERTIA - DRAG * omega - (omega > 0 ? RUB : 0);
    if (starter > 0 && omega < STARTER_SPEED) acc += 6 * (STARTER_SPEED - omega) + 400;
    omega = Math.min(MAX_OMEGA, Math.max(0, omega + acc * h));
    const r = advance({ ...st, theta, burnt }, theta + omega * h);
    st = r.state;
    theta = st.theta;
    burnt = st.burnt;
    events.spark ||= r.events.spark;
    events.power ||= r.events.power;
    events.cycleDone ||= r.events.cycleDone;
    if (r.events.power) starter = 0; // it has caught: the starter lets go
  }
  return { state: { ...st, omega, starter }, events };
}

// --- where the fuel's energy goes ---------------------------------------------------------------------------

/** Energy the fuel gives out in one power stroke, in shares (an illustration, not joules). */
export const FUEL_PER_POWER = 100;

/**
 * How the fuel's energy splits, in shares of 100. Illustrative numbers in the range textbook
 * exercises use; real engines vary with the model and how hard they work. What holds for both:
 * the exhaust carries off the biggest share, and a diesel turns more of it into work.
 */
export const ENERGY_SPLIT: Record<Kind, { work: number; exhaust: number; cooling: number; friction: number }> = {
  petrol: { work: 25, exhaust: 35, cooling: 30, friction: 10 },
  diesel: { work: 30, exhaust: 35, cooling: 25, friction: 10 },
};

/** Energy totals after some power strokes, and the efficiency η = W有用 / Q放 (null before the first). */
export function energyAfter(kind: Kind, powers: number) {
  const s = ENERGY_SPLIT[kind];
  const fuel = powers * FUEL_PER_POWER;
  const work = (powers * FUEL_PER_POWER * s.work) / 100;
  return { fuel, work, efficiency: fuel > 0 ? work / fuel : null };
}

/** Readings for the panel, counted from the start. */
export function readings(s: EngineState) {
  return {
    stroke: strokeOf(s.theta),
    angle: cycleAngle(s.theta),
    strokes: Math.floor(s.theta / 180 + 1e-9),
    turns: s.theta / 360,
    powers: s.powers,
  };
}
