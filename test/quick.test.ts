import { beforeEach, describe, expect, it } from 'vitest';
import {
  addColorHistory,
  addTextHistory,
  defaultQuickDraft,
  readColorHistory,
  readQuickDraft,
  readTextHistory,
  writeQuickDraft,
} from '../src/simple/quick-state';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('quick draft', () => {
  it('starts on the poster effect and returns null before anything is stored', () => {
    expect(readQuickDraft(false)).toBeNull();
    expect(defaultQuickDraft(false)).toEqual({ effectId: 'poster', text: '说大一点', fg: 'ffd60a', bg: '111111' });
  });

  it('round-trips the effect, words and colors', () => {
    writeQuickDraft({ effectId: 'rainbow', text: '生日快乐', fg: '#FF0000', bg: '000000' });
    expect(readQuickDraft(false)).toEqual({ effectId: 'rainbow', text: '生日快乐', fg: 'ff0000', bg: '000000' });
  });

  it('falls back to the poster effect and safe colors for a broken draft', () => {
    localStorage.setItem('bw-quick-draft', JSON.stringify({ effectId: 'nope', text: '留下', fg: '#fff', bg: 'zzzzzz' }));
    const draft = readQuickDraft(false)!;
    expect(draft.effectId).toBe('poster');
    expect(draft.text).toBe('留下');
    expect(draft.fg).toBe('ffd60a');
    expect(draft.bg).toBe('111111');
    localStorage.setItem('bw-quick-draft', 'not json');
    expect(readQuickDraft(false)).toBeNull();
  });
});

describe('text history', () => {
  it('keeps recent complete words, newest first, without duplicates or blanks', () => {
    expect(readTextHistory()).toEqual([]);
    expect(addTextHistory('  你好  ')).toEqual(['你好']);
    expect(addTextHistory('再见')).toEqual(['再见', '你好']);
    expect(addTextHistory('你好')).toEqual(['你好', '再见']);
    expect(addTextHistory('   ')).toEqual(['你好', '再见']);
  });

  it('caps the list at ten entries', () => {
    for (let i = 0; i < 14; i++) addTextHistory(`第 ${i} 条`);
    const history = readTextHistory();
    expect(history).toHaveLength(10);
    expect(history[0]).toBe('第 13 条');
    expect(history[9]).toBe('第 4 条');
  });
});

describe('color history', () => {
  it('keeps text and background colors apart, newest first', () => {
    expect(readColorHistory()).toEqual({ fg: [], bg: [] });
    expect(addColorHistory('fg', '#AAbbCC')).toEqual({ fg: ['aabbcc'], bg: [] });
    expect(addColorHistory('bg', '000000')).toEqual({ fg: ['aabbcc'], bg: ['000000'] });
    expect(addColorHistory('fg', 'aabbcc')).toEqual({ fg: ['aabbcc'], bg: ['000000'] });
    expect(addColorHistory('fg', 'not-a-color')).toEqual({ fg: ['aabbcc'], bg: ['000000'] });
  });

  it('caps each list at eight entries', () => {
    for (let i = 0; i < 12; i++) addColorHistory('fg', i.toString(16).padStart(6, '0'));
    expect(readColorHistory().fg).toHaveLength(8);
  });
});
