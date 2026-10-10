import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP, type Setup } from './physics';
import { floatReadings, floatStart, floatStep, outcome } from './float';

const setup = (cubeDensity: number, liquidDensity: number): Setup => ({ ...DEFAULT_SETUP, cubeDensity, liquidDensity });

function drop(s: Setup, seconds = 12) {
  let st = { ...floatStart(s, 13), held: false };
  for (let t = 0; t < seconds; t += 1 / 30) st = floatStep(st, 1 / 30, s);
  return st;
}

describe('float or sink', () => {
  it('wood (0.5) floats in water with half its height under', () => {
    const s = setup(500, 1000);
    const r = floatReadings(drop(s), s);
    expect(r.submerged).toBeCloseTo(s.cubeSide * 0.5, 2);
    expect(r.buoyancy).toBeCloseTo(r.weight, 3);
    expect(r.support).toBe(0);
    expect(r.resting).toBe(true);
    expect(outcome(s)).toBe('float');
  });

  it('wax (0.9) floats in water but sinks in alcohol (0.8)', () => {
    const inWater = setup(900, 1000);
    expect(floatReadings(drop(inWater), inWater).submerged).toBeCloseTo(inWater.cubeSide * 0.9, 2);
    const inAlcohol = setup(900, 800);
    const st = drop(inAlcohol);
    expect(st.y).toBe(0);
    expect(outcome(inAlcohol)).toBe('sink');
  });

  it('aluminium rests on the floor; the floor supplies G − F浮', () => {
    const s = setup(2700, 1000);
    const r = floatReadings(drop(s), s);
    expect(r.submerged).toBeCloseTo(s.cubeSide, 9);
    expect(r.support).toBeCloseTo(r.weight - r.buoyancy, 9);
    expect(r.resting).toBe(true);
  });

  it('a held cube does not move', () => {
    const s = setup(7900, 1000);
    const st = floatStep(floatStart(s, 13), 1 / 30, s);
    expect(st.y).toBe(13);
  });

  it('stays stable with a coarse time step', () => {
    const s = setup(500, 1100);
    let st = { ...floatStart(s, 13), held: false };
    for (let i = 0; i < 400; i++) st = floatStep(st, 1 / 20, s);
    expect(Number.isFinite(st.y)).toBe(true);
    expect(floatReadings(st, s).buoyancy).toBeCloseTo(floatReadings(st, s).weight, 3);
  });
});
