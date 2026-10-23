/**
 * A wall: several screens standing side by side, driven by one controller,
 * acting as a single wide sign.
 *
 * The screens are numbered 1..total from left to right. Together they make a
 * virtual canvas `total` screens wide, and screen `slot` shows the slice
 * `[(slot - 1) * W, slot * W)`. Every screen lays the text out the same way
 * and only shifts it, so the pieces meet at the seams.
 */

/** One screen's place in the wall. `slot` is 1-based, counting from the left. */
export interface Wall {
  slot: number;
  total: number;
}

/** Most screens one wall may hold. Matches the controller's list limit. */
export const MAX_WALL = 20;

/** Read a `wall` parameter (`2/3`), or null when it is not a usable wall. */
export function parseWall(value: string | undefined): Wall | null {
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const slot = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isInteger(slot) || !Number.isInteger(total)) return null;
  if (total < 2 || total > MAX_WALL || slot < 1 || slot > total) return null;
  return { slot, total };
}

/** The `wall` parameter for a screen. */
export function formatWall(wall: Wall): string {
  return `${wall.slot}/${wall.total}`;
}

/**
 * How far to slide this screen's text sideways so it shows its own slice.
 *
 * The text is laid out once across a canvas `total` screens wide, with the
 * wall's own margins at its outer edges and nothing between the screens, and
 * centred in what is left. Screen `slot` shows the slice starting `slot - 1`
 * screens in, so this is the distance from where its text would sit on its own
 * to where the shared layout puts it.
 *
 * `boxW` is one screen's width, `wallPadLeft` the wall's left margin and
 * `wallTextW` the width left for text across the whole wall. `contentLeft`
 * and `areaW` describe where this screen's own text area is.
 */
export function wallShift(boxW: number, wallPadLeft: number, wallTextW: number, contentLeft: number, areaW: number, wall: Wall): number {
  const center = wallPadLeft + wallTextW / 2 - (wall.slot - 1) * boxW;
  return center - contentLeft - areaW / 2;
}

/**
 * Where a marquee starts and ends across the whole wall, in px from where the
 * block would sit on its own. `perScreenW` is the text width one screen gets
 * out of the wall, which sets the speed: the same as an ordinary sign.
 */
export function wallMarquee(boxW: number, perScreenW: number, blockW: number, total: number): { from: number; to: number; seconds: number } {
  // The block is centred on the wall, so it starts just past the right edge of
  // the last screen and stops just past the left edge of the first. Both ends
  // are the same distance out, so the travel is symmetric about the middle.
  const edge = (boxW * total + blockW) / 2;
  return {
    from: edge,
    to: -edge,
    seconds: ((boxW * total + blockW) / Math.max(perScreenW, 1)) * 6,
  };
}

const START_KEY = 'bw-wall-start';
let startedAt: number | null | undefined;

/**
 * Start the wall's clock. Every screen is handed the same message at almost
 * the same moment, so counting from when it arrived keeps the screens in step
 * without their clocks having to agree. The player calls this when a wall
 * message arrives; a second call restarts the wall, which is how a controller
 * puts drifting screens back together.
 */
export function noteWallStart(now: number = Date.now()): void {
  startedAt = now;
  try {
    sessionStorage.setItem(START_KEY, String(now));
  } catch {
    // Storage can be blocked. The clock then lasts for this page only.
  }
  try {
    window.dispatchEvent(new Event('bw-wall'));
  } catch {
    // No window, as when this runs outside a page.
  }
}

/** Seconds since the wall started, or null when this screen was never told about one. */
export function wallElapsed(): number | null {
  if (startedAt === undefined) {
    startedAt = null;
    try {
      const saved = Number(sessionStorage.getItem(START_KEY));
      if (Number.isFinite(saved) && saved > 0) startedAt = saved;
    } catch {
      // Ignore blocked storage.
    }
  }
  return startedAt === null ? null : (Date.now() - startedAt) / 1000;
}
