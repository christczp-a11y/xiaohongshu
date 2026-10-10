import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP as S,
  cupArea,
  display,
  initialState,
  readings,
  settle,
  step,
  waterLevel,
} from './physics';

// Hand calculation for the default setup (aluminium cube, 5 cm side, in water, g = 9.8):
//   G   = 2700 kg/m³ × 125e-6 m³ × 9.8 = 3.3075 N
//   F浮 = 1000 kg/m³ × 125e-6 m³ × 9.8 = 1.225 N (fully submerged)
//   F   = 3.3075 − 1.225 = 2.0825 N

function lowerTo(cubeBottom: number) {
  let st = initialState(S, 18);
  // lower in small steps, like a drag gesture, then let the spout finish
  for (let y = 18; y > cubeBottom; y -= 0.25) st = step(st, Math.max(y, cubeBottom), 1 / 60, S);
  st = step(st, cubeBottom, 1 / 60, S);
  return settle(st, S);
}

describe('readings', () => {
  it('in air: scale reads the full weight, nothing overflows', () => {
    const r = readings(initialState(S, 18), S);
    expect(r.weight).toBeCloseTo(3.3075, 10);
    expect(r.buoyancy).toBe(0);
    expect(r.scaleReading).toBeCloseTo(3.3075, 10);
    expect(r.level).toBeCloseTo(S.spoutHeight, 10);
  });

  it('fully submerged: F浮 = 1.225 N and the beaker holds exactly the cube volume', () => {
    const st = lowerTo(3);
    const r = readings(st, S);
    expect(r.buoyancy).toBeCloseTo(1.225, 9);
    expect(r.scaleReading).toBeCloseTo(2.0825, 9);
    expect(st.beakerWater).toBeCloseTo(125, 6);
    expect(r.beakerWeight).toBeCloseTo(r.buoyancy, 9);
    expect(r.level).toBeCloseTo(S.spoutHeight, 9);
  });

  it('half submerged: F浮 = 0.6125 N', () => {
    const st = lowerTo(S.spoutHeight - 2.5);
    const r = readings(st, S);
    expect(r.submerged).toBeCloseTo(2.5, 9);
    expect(r.buoyancy).toBeCloseTo(0.6125, 9);
    expect(r.beakerWeight).toBeCloseTo(r.buoyancy, 9);
  });

  it('once submerged, going deeper does not change the buoyancy', () => {
    const a = readings(lowerTo(6), S).buoyancy;
    const b = readings(lowerTo(1), S).buoyancy;
    expect(a).toBeCloseTo(b, 9);
  });

  it('pulling out and lowering again overflows nothing more', () => {
    let st = lowerTo(3);
    st = settle(step(st, 18, 1 / 60, S), S);
    expect(readings(st, S).level).toBeLessThan(S.spoutHeight);
    st = settle(step(st, 3, 1 / 60, S), S);
    expect(st.beakerWater).toBeCloseTo(125, 6);
  });

  it('water is conserved', () => {
    const st0 = initialState(S, 18);
    let st = st0;
    for (let i = 0; i < 300; i++) st = step(st, 18 - (i % 100) * 0.17, 1 / 60, S);
    expect(st.cupWater + st.beakerWater).toBeCloseTo(st0.cupWater, 9);
  });
});

describe('waterLevel', () => {
  it('is continuous as the cube enters the water', () => {
    const V = cupArea(S) * 10;
    for (const yb of [9.999, 10, 10.001, 4.999, 5, 5.001]) {
      const l1 = waterLevel(V, yb, S);
      const l2 = waterLevel(V, yb + 1e-6, S);
      expect(Math.abs(l1 - l2)).toBeLessThan(1e-4);
    }
  });
});

describe('display', () => {
  it('prints numbers that satisfy F浮 = G − F', () => {
    const d = display(readings(lowerTo(3), S));
    expect(d).toEqual({ weight: '3.31', buoyancy: '1.23', scaleReading: '2.08', beakerWeight: '1.23' });
  });
});
