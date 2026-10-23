import { isPlayerId } from './protocol';

const STORAGE_KEY = 'bw-device-id';

interface IdBridge {
  getDeviceId?: () => string;
}

function bridge(): IdBridge | null {
  const host = (window as Window & { BigwordsAndroid?: IdBridge }).BigwordsAndroid;
  return host ?? null;
}

/**
 * True when the page runs inside the Android app's WebView. The app supplies
 * its own chrome and already fills the screen, so web-only controls hide there.
 */
export function inAppShell(): boolean {
  return bridge() !== null;
}

function storedId(): string {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && isPlayerId(saved)) return saved;
    // One-time move from the old per-browser store: the first page after the
    // upgrade keeps the id it was paired with, and every other page of this
    // browser then gets a fresh one of its own.
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy && isPlayerId(legacy)) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem(STORAGE_KEY, legacy);
      return legacy;
    }
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const id = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return '0000000000000000';
  }
}

/**
 * Stable id for this screen. The Android app derives it from the device; a
 * browser page keeps one of its own, so every player page (tab) pairs and
 * plays independently. A reload keeps the id; a page opened later gets a new one.
 */
export function deviceId(): string {
  try {
    const native = bridge()?.getDeviceId?.();
    if (native && isPlayerId(native)) return native;
  } catch {
    // The page is not running inside the Android app.
  }
  return storedId();
}
