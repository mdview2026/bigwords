import { EFFECTS, effectById, effectHex } from './effects';

/**
 * The home page's one-screen draft: the effect, the words and the two colors.
 * Unlike the old per-effect studio draft this belongs to the page itself, so
 * changing the effect keeps the words a person already typed.
 */
export interface QuickDraft {
  effectId: string;
  text: string;
  /** 6-digit hex without '#'. */
  fg: string;
  bg: string;
}

export interface ColorHistory {
  fg: string[];
  bg: string[];
}

const DRAFT_KEY = 'bw-quick-draft';
const TEXT_HISTORY_KEY = 'bw-quick-texts';
const COLOR_HISTORY_KEY = 'bw-quick-colors';
const TEXT_LIMIT = 10;
const COLOR_LIMIT = 8;

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Private mode can refuse both. The page still works for this visit.
    }
  }
}

function hexOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.replace(/^#/, '').trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(raw) ? raw : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The first-visit draft: the poster effect and its sample words. */
export function defaultQuickDraft(light: boolean): QuickDraft {
  const effect = EFFECTS[0];
  return {
    effectId: effect.id,
    text: effect.sample,
    fg: effectHex(effect, 'fg', light),
    bg: effectHex(effect, 'bg', light),
  };
}

export function readQuickDraft(light: boolean): QuickDraft | null {
  const raw = rawGet(DRAFT_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<QuickDraft> | null;
    if (!data || typeof data !== 'object') return null;
    const effect = effectById(typeof data.effectId === 'string' ? data.effectId : '') ?? EFFECTS[0];
    return {
      effectId: effect.id,
      text: typeof data.text === 'string' ? data.text : effect.sample,
      fg: hexOrNull(data.fg) ?? effectHex(effect, 'fg', light),
      bg: hexOrNull(data.bg) ?? effectHex(effect, 'bg', light),
    };
  } catch {
    return null;
  }
}

export function writeQuickDraft(draft: QuickDraft): void {
  const effect = effectById(draft.effectId) ?? EFFECTS[0];
  const safe: QuickDraft = {
    effectId: effect.id,
    text: draft.text,
    fg: hexOrNull(draft.fg) ?? effectHex(effect, 'fg', false),
    bg: hexOrNull(draft.bg) ?? effectHex(effect, 'bg', false),
  };
  rawSet(DRAFT_KEY, JSON.stringify(safe));
}

/** Recent words, newest first. Only complete strings are kept. */
export function readTextHistory(): string[] {
  const raw = rawGet(TEXT_HISTORY_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return unique(
      data
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ).slice(0, TEXT_LIMIT);
  } catch {
    return [];
  }
}

export function addTextHistory(text: string): string[] {
  const value = text.trim();
  const list = readTextHistory();
  if (!value) return list;
  const next = [value, ...list.filter((item) => item !== value)].slice(0, TEXT_LIMIT);
  rawSet(TEXT_HISTORY_KEY, JSON.stringify(next));
  return next;
}

/** Recent text and background colors, newest first, kept apart. */
export function readColorHistory(): ColorHistory {
  const raw = rawGet(COLOR_HISTORY_KEY);
  if (!raw) return { fg: [], bg: [] };
  try {
    const data = JSON.parse(raw) as Partial<ColorHistory> | null;
    if (!data || typeof data !== 'object') return { fg: [], bg: [] };
    const clean = (value: unknown): string[] =>
      Array.isArray(value)
        ? unique(value.map(hexOrNull).filter((item): item is string => item !== null)).slice(0, COLOR_LIMIT)
        : [];
    return { fg: clean(data.fg), bg: clean(data.bg) };
  } catch {
    return { fg: [], bg: [] };
  }
}

export function addColorHistory(kind: 'fg' | 'bg', color: string): ColorHistory {
  const value = hexOrNull(color);
  const history = readColorHistory();
  if (!value) return history;
  const next: ColorHistory = { ...history, [kind]: [value, ...history[kind].filter((item) => item !== value)].slice(0, COLOR_LIMIT) };
  rawSet(COLOR_HISTORY_KEY, JSON.stringify(next));
  return next;
}
