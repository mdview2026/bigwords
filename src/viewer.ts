import { lockPlayback, unlockPlayback } from './orient';
import { sitePath } from './paths';
import { canFullscreen, fullscreenElement } from './remote/fullscreen';
import { Display } from './render/display';
import { readDraft, writeDraft } from './simple/draft';
import { parseFragment, serializeFragment } from './state/fragment';
import { PARAM_ORDER, resolveSettings, type Settings } from './state/params';

const SIZE_MIN = 4;
const SIZE_MAX = 70;

function clampSize(vh: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, vh));
}

function fittedVh(stage: HTMLElement): number {
  const block = stage.querySelector<HTMLElement>('.bw-block');
  const px = block ? parseFloat(getComputedStyle(block).fontSize) : NaN;
  const height = stage.clientHeight || 1;
  if (!Number.isFinite(px) || px <= 0) return 18;
  return (px / height) * 100;
}

/** Where to return when leaving a fullscreen display, set by the page that opened it. */
export const VIEWER_RETURN_KEY = 'bw-viewer-return';

function samePlace(url: URL): boolean {
  if (location.protocol === 'file:') return url.protocol === 'file:';
  return url.origin === location.origin;
}

/** Leave the fullscreen display and go back to editing, or to the effect list.
 * Pop the history entry. Opening the editor again with assign would sit on top
 * of this page, and the next system back gesture would return to playback. */
function leaveViewer(): void {
  unlockPlayback();
  const saved = sessionStorage.getItem(VIEWER_RETURN_KEY);
  sessionStorage.removeItem(VIEWER_RETURN_KEY);
  if (history.length > 1) {
    history.back();
    return;
  }
  location.replace(returnHref(saved));
}

function returnHref(saved: string | null): string {
  if (!saved) return sitePath('/');
  try {
    const url = new URL(saved, location.href);
    if (samePlace(url) && url.href !== location.href) return url.href;
  } catch {
    // Ignore a broken saved address and use the fallback below.
  }
  return sitePath('/');
}

/** Fullscreen viewer: renders the fragment with zero UI chrome. */
export function mountViewer(app: HTMLElement): { update(): void; destroy(): void } {
  document.body.className = 'page-viewer';
  const stage = document.createElement('div');
  stage.className = 'viewer-stage';
  app.replaceChildren(stage);
  const place = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    stage.style.top = `${vv.offsetTop}px`;
    stage.style.left = `${vv.offsetLeft}px`;
    stage.style.width = `${vv.width}px`;
    stage.style.height = `${vv.height}px`;
  };
  place();
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
  lockPlayback();

  /* True fullscreen on phones and tablets: hide the browser's own bars so
     the sign owns every pixel. Entry points that stay in this document (the
     landing page's play links, the editors' play button via go()) keep the
     tap's transient activation alive, so the mount-time attempt below goes
     straight to fullscreen; a cross-document open (new tab, shared link)
     rejects silently and the first tap on the stage asks instead. A
     rejection never gives up - it usually just means the gesture had
     expired - but once the user leaves fullscreen, single taps stay out of
     it and only another double-tap brings it back. Orientation lock on
     Android only holds in fullscreen, so playback locks again once a
     request succeeds. */
  let fsUserLeft = false;
  const rootEl = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const coarseTap = () => matchMedia('(pointer: coarse)').matches;
  const enterFullscreen = () => {
    if (fsUserLeft || fullscreenElement() || !canFullscreen()) return;
    // Checked at tap time, not at mount: the media feature can lag the
    // device's real pointer when playback opens right after navigation.
    if (!coarseTap()) return;
    try {
      const done = rootEl.requestFullscreen
        ? rootEl.requestFullscreen({ navigationUI: 'hide' })
        : rootEl.webkitRequestFullscreen?.();
      Promise.resolve(done).then(() => lockPlayback(), () => undefined);
    } catch {
      // A synchronous failure (e.g. inside a WebView) stays silent too.
    }
  };
  const exitFullscreen = () => {
    if (!fullscreenElement()) return;
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    try {
      Promise.resolve((doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)).catch(() => undefined);
    } catch {
      // Leaving fullscreen is best-effort.
    }
  };
  /* Double-tap toggles fullscreen. An explicit exit marks fullscreen as
     user-left, so the single-tap re-entry in onPointerDown does not undo it
     mid-gesture. */
  const toggleFullscreen = () => {
    if (fullscreenElement()) {
      fsUserLeft = true;
      exitFullscreen();
      return;
    }
    fsUserLeft = false;
    enterFullscreen();
  };
  const onFsChange = () => {
    if (!fullscreenElement()) fsUserLeft = true;
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  enterFullscreen();
  let leaving = false;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    leaveViewer();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.repeat) return;
    event.preventDefault();
    leave();
  };
  const display = new Display(stage);
  let settings: Settings;
  const sideOf = (x: number): 'left' | 'right' | 'middle' => {
    const width = stage.clientWidth || window.innerWidth;
    if (x < width * 0.28) return 'left';
    if (x > width * 0.72) return 'right';
    return 'middle';
  };
  const rememberTune = () => {
    const sizeVh = Math.round(clampSize(fittedVh(stage)) * 10) / 10;
    const pace = Math.round(display.pace() * 100) / 100;
    const state = parseFragment(location.hash);
    state.params.size = `${sizeVh}vh`;
    state.params.pace = String(pace);
    const fragment = serializeFragment(state, PARAM_ORDER);
    history.replaceState(null, '', `${location.href.split('#')[0]}#${fragment}`);
    const saved = sessionStorage.getItem(VIEWER_RETURN_KEY);
    let id: string | null = null;
    if (saved) {
      try {
        id = new URL(saved, location.href).searchParams.get('e');
      } catch {
        id = null;
      }
    }
    if (!id) return;
    const draft = readDraft(id);
    if (!draft) return;
    writeDraft(id, { ...draft, size: sizeVh, pace });
  };
  let lastTap = 0;
  let lastX = 0;
  let lastY = 0;
  let tuned = false;
  let drag: { id: number; x: number; y: number; side: 'left' | 'right' | 'middle'; moved: boolean } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    enterFullscreen();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, side: sideOf(event.clientX), moved: false };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone.
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = drag.y - event.clientY;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    drag.moved = true;
    lastTap = 0;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (dy === 0 || drag.side === 'middle') return;
    if (drag.side === 'right') {
      display.setSize({ value: clampSize(fittedVh(stage) * Math.exp(dy * 0.005)), unit: 'vh' });
      tuned = true;
      return;
    }
    if (settings?.anim && settings.anim !== 'none') {
      display.setPace(display.pace() * Math.exp(dy * 0.004));
      tuned = true;
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.id) {
      const moved = drag.moved;
      drag = null;
      if (moved) {
        if (tuned) rememberTune();
        tuned = false;
        return;
      }
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const now = performance.now();
    const near = Math.hypot(event.clientX - lastX, event.clientY - lastY) < 48;
    if (lastTap !== 0 && now - lastTap < 300 && near) {
      lastTap = 0;
      /* Touch devices with a Fullscreen API toggle true fullscreen; playback
         itself is left with the system back gesture. Everywhere else (no
         Fullscreen API, desktop) a double-tap still leaves playback. */
      if (canFullscreen() && coarseTap()) toggleFullscreen();
      else leave();
      return;
    }
    lastTap = now;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  window.addEventListener('keydown', onKey);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);

  let refreshTimer = 0;
  let lock: WakeLockSentinel | null = null;

  const acquireLock = async () => {
    if (!settings?.wake || lock || document.visibilityState !== 'visible') return;
    try {
      lock = (await navigator.wakeLock?.request('screen')) ?? null;
      lock?.addEventListener('release', () => {
        lock = null;
      });
    } catch {
      // Unsupported or denied: fall back silently.
    }
  };
  const releaseLock = () => {
    void lock?.release().catch(() => undefined);
    lock = null;
  };
  const onVisibility = () => void acquireLock();
  document.addEventListener('visibilitychange', onVisibility);

  const update = () => {
    settings = resolveSettings(parseFragment(location.hash));
    display.update(settings);
    clearTimeout(refreshTimer);
    if (settings.refresh) {
      refreshTimer = window.setTimeout(() => location.reload(), settings.refresh * 1000);
    }
    if (settings.wake) void acquireLock();
    else releaseLock();
  };
  update();

  return {
    update,
    destroy() {
      clearTimeout(refreshTimer);
      unlockPlayback();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      exitFullscreen();
      releaseLock();
      display.destroy();
    },
  };
}
