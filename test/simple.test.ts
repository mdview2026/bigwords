import { describe, expect, it } from 'vitest';
import { EFFECTS, effectById, effectFragment, effectHex, presentMessage } from '../src/simple/effects';
import { parseFragment } from '../src/state/fragment';

describe('simple effects', () => {
  it('keeps formatting markers out of the text a person edits', () => {
    const poster = effectById('poster')!;
    expect(poster.sample.includes('*')).toBe(false);
    expect(presentMessage(poster, '说大一点')).toBe('**说大一点**');
    expect(presentMessage(effectById('sign')!, '12 号门\n请从这里进')).toBe('# 12 号门\n请从这里进');
  });

  it('writes a chosen size into the viewer link and drops a size cap', () => {
    const ticker = effectById('ticker')!;
    const state = parseFragment(effectFragment({ ...ticker, params: { ...ticker.params, 'size-max': '20vh' } }, '你好', 12.34));
    expect(state.message).toBe('你好');
    expect(state.params.size).toBe('12.3vh');
    expect(state.params['size-max']).toBeUndefined();
    expect(state.params.anim).toBe('scroll');
    expect(state.params.bg).toBe('000000');
  });

  it('keeps an effect color until a person picks a different one', () => {
    const poster = effectById('poster')!;
    expect(effectHex(poster, 'fg', true)).toBe('ffd60a');
    const same = parseFragment(effectFragment(poster, '你好', null, { fg: null, bg: null }));
    expect(same.params.fg).toBe('ffd60a');
    expect(same.params.bg).toBe('111111');
    const picked = parseFragment(effectFragment(poster, '你好', null, { fg: 'ffffff', bg: '0b3d91' }));
    expect(picked.params.fg).toBe('ffffff');
    expect(picked.params.bg).toBe('0b3d91');
    const paced = parseFragment(effectFragment(poster, '你好', null, { pace: 1.25 }));
    expect(paced.params.pace).toBe('1.25');
  });

  it('uses a unique id for every effect', () => {
    expect(new Set(EFFECTS.map((effect) => effect.id)).size).toBe(EFFECTS.length);
  });
});
