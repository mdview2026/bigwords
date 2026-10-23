import { describe, expect, it } from 'vitest';
import { drawChipX, drawPlan, drawWinner } from '../src/render/draw';
import { drawFragment } from '../src/remote/protocol';
import { parseFragment } from '../src/state/fragment';

describe('lucky draw winner', () => {
  it('spreads consecutive seeds over every screen', () => {
    for (const total of [2, 3, 5, 20]) {
      const seen = new Set(new Array(total).fill(0).map((_, seed) => drawWinner(seed, total)));
      expect(seen.size).toBe(total);
    }
  });

  it('is a valid slot for any seed', () => {
    for (const seed of [0, 1, 999999999, Number.MAX_SAFE_INTEGER]) {
      for (const total of [1, 2, 7]) {
        const w = drawWinner(seed, total);
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(total);
      }
    }
  });

  it('lets a lone screen win by default', () => {
    expect(drawWinner(5, 1)).toBe(1);
    expect(drawWinner(5, 0)).toBe(1);
  });
});

describe('lucky draw flight', () => {
  const boxW = 400;
  it('starts parked at the left edge and rests exactly on the winner', () => {
    for (const total of [1, 2, 3, 6, 20]) {
      for (let seed = 0; seed < total; seed++) {
        const winner = drawWinner(seed, total);
        const plan = drawPlan(boxW, total, winner);
        expect(drawChipX(plan, 0)).toBeCloseTo(plan.minX, 9);
        expect(drawChipX(plan, plan.seconds)).toBeCloseTo((winner - 0.5) * boxW, 9);
        expect(drawChipX(plan, plan.seconds * 2)).toBeCloseTo((winner - 0.5) * boxW, 9); // stays at rest
      }
    }
  });

  it('never leaves the wall', () => {
    const plan = drawPlan(boxW, 4, 3);
    for (let i = 0; i <= 400; i++) {
      const x = drawChipX(plan, (i / 400) * plan.seconds);
      expect(x).toBeGreaterThanOrEqual(plan.minX - 1e-9);
      expect(x).toBeLessThanOrEqual(plan.maxX + 1e-9);
    }
  });

  it('accelerates from a crawl and decelerates into the stop', () => {
    const plan = drawPlan(boxW, 3, drawWinner(2, 3));
    const speed = (t: number) =>
      Math.abs(drawChipX(plan, t + 0.05) - drawChipX(plan, t - 0.05)) / 0.1;
    const early = speed(plan.seconds * 0.1);
    const middle = speed(plan.seconds * 0.5);
    const late = speed(plan.seconds * 0.95);
    expect(middle).toBeGreaterThan(early * 5);
    expect(middle).toBeGreaterThan(late * 5);
  });

  it('keeps the flight long enough to be worth watching', () => {
    expect(drawPlan(boxW, 2, 1).seconds).toBeGreaterThanOrEqual(8);
    expect(drawPlan(boxW, 20, 1).seconds).toBeLessThanOrEqual(24);
  });
});

describe('draw fragment', () => {
  it('numbers each screen and shares the seed and colours', () => {
    const state = parseFragment(drawFragment(2, 5, 48271));
    expect(state.message).toBe('**2**');
    expect(state.params.anim).toBe('draw');
    expect(state.params.draw).toBe('48271');
    expect(state.params.wall).toBe('2/5');
    expect(state.params.bg).toBe('000000');
    expect(state.params.fg).toBe('ffffff');
  });

  it('leaves a lone screen without a wall', () => {
    const state = parseFragment(drawFragment(1, 1, 7));
    expect(state.params.wall).toBeUndefined();
  });

  it('carries the same seed to every screen of a wall', () => {
    const seeds = new Set([1, 2, 3].map((slot) => parseFragment(drawFragment(slot, 3, 99)).params.draw));
    expect(seeds.size).toBe(1);
  });
});
