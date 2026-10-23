export interface Draft {
  text: string;
  size: number | null;
  fg: string | null;
  bg: string | null;
  /** Playback speed. 1 is normal, 2 is twice as fast. */
  pace: number | null;
}

function draftKey(id: string): string {
  return `bw-draft:${id}`;
}

function hexOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readDraft(id: string): Draft | null {
  const raw = readRaw(draftKey(id));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Draft>;
    if (typeof data.text !== 'string') return null;
    const size = typeof data.size === 'number' && data.size > 0 ? data.size : null;
    const pace = typeof data.pace === 'number' && data.pace > 0 ? data.pace : null;
    return { text: data.text, size, fg: hexOrNull(data.fg), bg: hexOrNull(data.bg), pace };
  } catch {
    return null;
  }
}

export function writeDraft(id: string, draft: Draft): void {
  const key = draftKey(id);
  const raw = JSON.stringify(draft);
  try {
    localStorage.setItem(key, raw);
  } catch {
    try {
      sessionStorage.setItem(key, raw);
    } catch {
      // Private mode can refuse storage. The screen still works for this visit.
    }
  }
}
