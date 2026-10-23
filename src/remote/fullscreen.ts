import { toast } from '../chrome';

// Older Safari spells the Fullscreen API with a webkit prefix and promises nothing.
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

export function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Hide the browser's own bars so the sign owns the whole screen. Entering needs a tap, so the button is the gesture. */
export function toggleFullscreen(): void {
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenRoot;
  const done = fullscreenElement()
    ? (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)
    : (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
  Promise.resolve(done).catch(() => toast('无法进入全屏'));
}

export function canFullscreen(): boolean {
  const root = document.documentElement as FullscreenRoot;
  return typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
}
