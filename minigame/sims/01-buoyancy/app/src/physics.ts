// Buoyancy model for scene A (称一称): a solid cube hung from a spring scale
// is lowered into an overflow cup that starts filled to its spout.
// Lengths are in cm, volumes in cm³, densities in kg/m³, forces in N.
// Idealisations (stated on the in-app "about" page): rigid upright cylinder
// cup, no surface tension or meniscus, water leaves only through the spout.

export interface Setup {
  cupRadius: number; // inner radius of the overflow cup
  spoutHeight: number; // spout height above the cup's inner floor
  cubeSide: number;
  cubeDensity: number;
  liquidDensity: number;
  g: number; // N/kg
  spoutConductance: number; // cm²/s; outflow = conductance × head above spout
}

export interface State {
  cupWater: number; // water volume inside the cup
  beakerWater: number; // water collected in the small beaker
  cubeBottom: number; // cube bottom height above the cup's inner floor
}

export const CM3 = 1e-6; // m³ per cm³

export const DEFAULT_SETUP: Setup = {
  cupRadius: 6,
  spoutHeight: 12,
  cubeSide: 4.5, // small enough that iron and copper stay within a 0–10 N scale
  cubeDensity: 2700, // aluminium
  liquidDensity: 1000, // water
  g: 9.8,
  spoutConductance: 150,
};

export function cupArea(s: Setup): number {
  return Math.PI * s.cupRadius * s.cupRadius;
}

export function initialState(s: Setup, cubeBottom: number): State {
  return { cupWater: cupArea(s) * s.spoutHeight, beakerWater: 0, cubeBottom };
}

/** Depth of the cube below a given water level, clamped to [0, side]. */
export function submergedDepth(level: number, cubeBottom: number, side: number): number {
  return Math.min(Math.max(level - cubeBottom, 0), side);
}

/** Water level for a given water volume with the cube at `cubeBottom`. */
export function waterLevel(cupWater: number, cubeBottom: number, s: Setup): number {
  const A = cupArea(s);
  const a2 = s.cubeSide * s.cubeSide;
  const below = cupWater / A;
  if (below <= cubeBottom) return below;
  const across = (cupWater - a2 * cubeBottom) / (A - a2);
  if (across < cubeBottom + s.cubeSide) return across;
  return (cupWater + a2 * s.cubeSide) / A;
}

/** Water volume that fills the cup exactly to the spout with the cube where it is. */
export function capacityAtSpout(cubeBottom: number, s: Setup): number {
  const a2 = s.cubeSide * s.cubeSide;
  return cupArea(s) * s.spoutHeight - a2 * submergedDepth(s.spoutHeight, cubeBottom, s.cubeSide);
}

/**
 * Move the cube and let water drain through the spout for `dt` seconds.
 * Draining is gradual so the beaker visibly fills; `settle` drains it all.
 */
export function step(state: State, cubeBottom: number, dt: number, s: Setup): State {
  let { cupWater, beakerWater } = state;
  const excess = cupWater - capacityAtSpout(cubeBottom, s);
  if (excess > 0) {
    const head = waterLevel(cupWater, cubeBottom, s) - s.spoutHeight;
    let flow = Math.min(excess, s.spoutConductance * head * dt);
    if (excess - flow < 1e-6) flow = excess;
    cupWater -= flow;
    beakerWater += flow;
  }
  return { cupWater, beakerWater, cubeBottom };
}

export function settle(state: State, s: Setup): State {
  const excess = state.cupWater - capacityAtSpout(state.cubeBottom, s);
  if (excess <= 0) return state;
  return { ...state, cupWater: state.cupWater - excess, beakerWater: state.beakerWater + excess };
}

export interface Readings {
  level: number;
  submerged: number; // cm
  displacedVolume: number; // cm³
  weight: number; // G
  buoyancy: number; // F浮
  scaleReading: number; // F = G − F浮
  beakerWeight: number; // G排, weighed from the collected water
}

export function readings(state: State, s: Setup): Readings {
  const level = waterLevel(state.cupWater, state.cubeBottom, s);
  const submerged = submergedDepth(level, state.cubeBottom, s.cubeSide);
  const displacedVolume = s.cubeSide * s.cubeSide * submerged;
  const weight = s.cubeDensity * s.cubeSide ** 3 * CM3 * s.g;
  const buoyancy = s.liquidDensity * displacedVolume * CM3 * s.g;
  return {
    level,
    submerged,
    displacedVolume,
    weight,
    buoyancy,
    scaleReading: weight - buoyancy,
    beakerWeight: s.liquidDensity * state.beakerWater * CM3 * s.g,
  };
}

/** Round to 2 decimals; the epsilon keeps 1.225 from printing as 1.22. */
export function round2(x: number): number {
  return Math.round(x * 100 + 1e-6) / 100;
}

export interface Display {
  weight: string;
  scaleReading: string;
  buoyancy: string;
  beakerWeight: string;
}

/**
 * Two-decimal strings for the panel. The scale reading is derived from the
 * rounded G and F浮 so the printed numbers always satisfy F浮 = G − F.
 */
export function display(r: Readings): Display {
  const G = round2(r.weight);
  const Fb = round2(r.buoyancy);
  return {
    weight: G.toFixed(2),
    buoyancy: Fb.toFixed(2),
    scaleReading: (G - Fb).toFixed(2),
    beakerWeight: round2(r.beakerWeight).toFixed(2),
  };
}
