import { describe, expect, it, vi } from 'vitest';
import { formatWall, MAX_WALL, noteWallStart, parseWall, wallElapsed, wallMarquee, wallShift } from '../src/wall';

describe('wall parameter', () => {
  it('reads a slice of a wall and writes it back', () => {
    expect(parseWall('2/3')).toEqual({ slot: 2, total: 3 });
    expect(parseWall(' 2 / 3 ')).toEqual({ slot: 2, total: 3 });
    expect(formatWall({ slot: 2, total: 3 })).toBe('2/3');
    expect(parseWall(`${MAX_WALL}/${MAX_WALL}`)).toEqual({ slot: MAX_WALL, total: MAX_WALL });
  });

  it('refuses anything that is not a wall', () => {
    // A sign on its own is not a wall, so it keeps no wall parameter.
    expect(parseWall('1/1')).toBeNull();
    expect(parseWall('')).toBeNull();
    expect(parseWall(undefined)).toBeNull();
    expect(parseWall('0/2')).toBeNull();
    expect(parseWall('3/2')).toBeNull();
    expect(parseWall('2/3/4')).toBeNull();
    expect(parseWall('2.5/3')).toBeNull();
    expect(parseWall('a/b')).toBeNull();
    expect(parseWall(`${MAX_WALL + 1}/${MAX_WALL + 1}`)).toBeNull();
  });
});

describe('wall geometry', () => {
  const box = 400;
  const pad = 0.05; // 5% of the box, the default padding
  const total = 3;
  // What one screen of this wall lays out, as display.ts works it out.
  const left = pad * box;
  const textW = box * total - 2 * pad * box;
  const areaW = box - 2 * left;
  const perScreen = textW / total;
  const shift = (slot: number) => wallShift(box, left, textW, left, areaW, { slot, total });

  it('offsets each screen by exactly one screen width', () => {
    expect(shift(2) - shift(1)).toBe(-box);
    expect(shift(3) - shift(2)).toBe(-box);
  });

  it('puts the text in the same place in the wall on every screen', () => {
    // Where the middle of the text lands, measured in the wall's own
    // coordinates rather than this screen's.
    const virtualCenter = (slot: number) => (slot - 1) * box + left + shift(slot) + areaW / 2;
    const center = left + textW / 2;
    for (const slot of [1, 2, 3]) expect(virtualCenter(slot)).toBeCloseTo(center, 6);
  });

  it('keeps the wall margins at the two outer edges', () => {
    // A block as wide as the wall's text area starts at the left margin and
    // ends at the right one.
    const virtualLeft = (slot: number) => (slot - 1) * box + left + shift(slot) + (areaW - textW) / 2;
    expect(virtualLeft(1)).toBeCloseTo(left, 6);
    expect(virtualLeft(1) + textW).toBeCloseTo(left + textW, 6);
    expect(left + textW).toBeCloseTo(box * total - left, 6);
  });

  it('sends a marquee across the whole wall, at one screen speed', () => {
    const m = wallMarquee(box, perScreen, 1000, total);
    expect(m.from - m.to).toBe(1000 + box * total);
    expect(m.seconds).toBeCloseTo(((box * total + 1000) / perScreen) * 6, 6);
  });
});

describe('wall clock', () => {
  it('counts from the moment the wall started', () => {
    vi.useFakeTimers();
    noteWallStart();
    expect(wallElapsed()).toBe(0);
    vi.advanceTimersByTime(2500);
    expect(wallElapsed()).toBeCloseTo(2.5, 3);
    // A second message restarts the wall, which is how a controller lines up
    // a screen that drifted.
    noteWallStart();
    expect(wallElapsed()).toBe(0);
    vi.useRealTimers();
  });

  it('is null on a screen that was never told about a wall', async () => {
    sessionStorage.clear();
    vi.resetModules();
    const fresh = await import('../src/wall');
    expect(fresh.wallElapsed()).toBeNull();
  });
});
