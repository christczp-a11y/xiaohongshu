import { describe, expect, it } from 'vitest';
import {
  CRANK_R,
  STROKE,
  advance,
  gasTorque,
  initialState,
  pinSpeed,
  pistonDrop,
  readings,
  step,
  strokeOf,
  valveLift,
} from './engine';

const mid = [90, 270, 450, 630]; // the middle of each stroke

describe('one working cycle', () => {
  it('has four strokes in order: intake, compression, power, exhaust', () => {
    expect(mid.map(strokeOf)).toEqual(['intake', 'compression', 'power', 'exhaust']);
  });

  it('turns the crank twice, moves the piston down and up twice, and does work once', () => {
    const r = readings(advance(initialState(), 720).state);
    expect(r.strokes).toBe(4);
    expect(r.turns).toBe(2);
    expect(r.powers).toBe(1);
    // the piston is at the top at 0° and 360°, at the bottom at 180° and 540°
    for (const top of [0, 360, 720]) expect(pistonDrop(top)).toBeCloseTo(0, 6);
    for (const bottom of [180, 540]) expect(pistonDrop(bottom)).toBeCloseTo(STROKE, 6);
  });

  it('keeps counting the same way over many cycles', () => {
    const r = readings(advance(initialState(), 720 * 5).state);
    expect([r.strokes, r.turns, r.powers]).toEqual([20, 10, 5]);
  });

  it('counts the same whether turned in one go or in small steps', () => {
    let s = initialState();
    for (let a = 7; a <= 1440; a += 7) s = advance(s, a).state;
    s = advance(s, 1440).state;
    expect(s.powers).toBe(2);
  });

  it('does no work when the plug does not fire', () => {
    const s = advance({ ...initialState(), ignition: false }, 720 * 3).state;
    expect(s.powers).toBe(0);
  });
});

describe('piston and valves', () => {
  it('moves down in intake and power, up in compression and exhaust', () => {
    const down = mid.map((a) => pinSpeed(a) < 0);
    expect(down).toEqual([true, false, true, false]);
  });

  it('opens only the intake valve while drawing in, only the exhaust valve while pushing out', () => {
    const v = mid.map(valveLift);
    expect(v[0].intake).toBeGreaterThan(0.9);
    expect(v[0].exhaust).toBe(0);
    expect(v[3].exhaust).toBeGreaterThan(0.9);
    expect(v[3].intake).toBe(0);
    // both shut through compression and power
    for (let a = 181; a < 540; a += 3) {
      expect(valveLift(a).intake).toBe(0);
      expect(valveLift(a).exhaust).toBe(0);
    }
  });

  it('has a stroke of twice the crank radius', () => {
    expect(STROKE).toBe(2 * CRANK_R);
  });
});

describe('energy', () => {
  const work = (a: number, b: number, burnt: boolean) => {
    let w = 0;
    for (let x = a; x < b; x += 0.25) w += gasTorque(x + 0.125, burnt) * 0.25;
    return w;
  };

  it('takes work from the flywheel to squeeze the charge (mechanical energy to internal energy)', () => {
    expect(work(180, 360, false)).toBeLessThan(0);
  });

  it('gives back more than that in the power stroke once it has burnt (internal energy to mechanical energy)', () => {
    const squeeze = -work(180, 360, true);
    const push = work(360, 540, true);
    expect(push).toBeGreaterThan(2 * squeeze);
  });

  it('only pushes the piston in the power stroke; the other three strokes ride on the flywheel', () => {
    for (const a of [90, 270, 630]) expect(gasTorque(a, true)).toBeLessThanOrEqual(0);
    expect(gasTorque(450, true)).toBeGreaterThan(0);
  });
});

describe('running on its own', () => {
  it('keeps going once started, firing once per cycle', () => {
    let s = { ...initialState(), starter: 3 };
    let sparks = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const r = step(s, 1 / 60);
      s = r.state;
      if (r.events.spark) sparks++;
    }
    expect(s.omega).toBeGreaterThan(100);
    expect(s.powers).toBeGreaterThan(8);
    expect(Math.abs(sparks - s.powers)).toBeLessThanOrEqual(1);
    // and still turns slowly enough to watch: a cycle takes a few seconds
    const cycles = s.theta / 720;
    expect(40 / cycles).toBeGreaterThan(2);
  });

  it('coasts to a stop after the ignition is switched off', () => {
    let s = { ...initialState(), starter: 3 };
    for (let i = 0; i < 60 * 10; i++) s = step(s, 1 / 60).state;
    s = { ...s, ignition: false };
    const powers = s.powers;
    for (let i = 0; i < 60 * 30; i++) s = step(s, 1 / 60).state;
    expect(s.omega).toBe(0);
    expect(s.powers - powers).toBeLessThanOrEqual(1);
  });

  it('does not catch when let go too slowly in the compression stroke', () => {
    let s = advance(initialState(), 300).state;
    s = { ...s, omega: 40 };
    for (let i = 0; i < 60 * 10; i++) s = step(s, 1 / 60).state;
    expect(s.omega).toBe(0);
    expect(s.powers).toBe(0);
  });
});
