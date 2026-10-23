/** How the phone is held while the sign is on screen. Landscape is the default. */
export type DisplayOrient = 'landscape' | 'portrait';

const KEY = 'bw-orient';

interface AndroidBridge {
  getOrientation?: () => string;
  setOrientation?: (value: string) => void;
}

function bridge(): AndroidBridge | null {
  const host = (window as Window & { BigwordsAndroid?: AndroidBridge }).BigwordsAndroid;
  return host ?? null;
}

export function normalizeOrient(value: unknown): DisplayOrient | null {
  return value === 'portrait' || value === 'landscape' ? value : null;
}

/** Saved choice, or landscape when nothing has been chosen yet. */
export function readOrient(): DisplayOrient {
  try {
    const native = normalizeOrient(bridge()?.getOrientation?.());
    if (native) return native;
  } catch {
    // The page is not running inside the Android app.
  }
  try {
    const saved = normalizeOrient(sessionStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    // Private browsing can block sessionStorage.
  }
  return 'landscape';
}

/** Remember the choice. The phone stays as the system left it until playback. */
export function saveOrient(value: DisplayOrient): void {
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // The Android app keeps its own copy when storage is blocked.
  }
  try {
    bridge()?.setOrientation?.(value);
  } catch {
    // No Android bridge on a normal browser page.
  }
}

/** Turn the phone to the saved direction. Used only while the sign is playing. */
export function lockPlayback(): void {
  const value = readOrient();
  try {
    const pending = screen.orientation?.lock?.(value);
    void pending?.catch(() => undefined);
  } catch {
    // This browser cannot lock the screen.
  }
}

/** Let the system choose the direction again after playback. */
export function unlockPlayback(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // This browser cannot lock the screen.
  }
}
