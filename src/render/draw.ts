/**
 * Lucky draw: a bright chip shuttles back and forth across a wall of screens
 * and settles on one of them, which wins.
 *
 * The whole flight is a function of the wall's shared clock and one seed, so
 * every screen works out the same trajectory on its own and they never have
 * to talk to each other while it runs. The seed comes from the controller and
 * rides in the URL, which is also what makes the draw reproducible: the same
 * seed on the same screens always stops on the same winner.
 */

/**
 * The screen the seed picks. One screen on its own always wins — there is
 * nobody else to beat — and with two or more every screen is equally likely.
 */
export function drawWinner(seed: number, total: number): number {
  const n = Math.floor(total);
  if (n <= 1) return 1;
  return (Math.floor(Math.abs(seed)) % n) + 1;
}

/** One flight of the chip, in wall pixels. */
export interface DrawPlan {
  /** The chip's width, so the controller and every screen size it alike. */
  chipW: number;
  /** Where the chip's centre may travel: the wall's edges, less half a chip. */
  minX: number;
  maxX: number;
  /** Where the chip starts: parked at the wall's left edge. */
  x0: number;
  /** The winning screen's centre, where the chip comes to rest. */
  target: number;
  /** The whole distance flown, whole spans plus the final approach. */
  theta: number;
  /** Seconds of flight: slow away, fast across, slower and slower to rest. */
  seconds: number;
}

export function drawPlan(boxW: number, total: number, winner: number): DrawPlan {
  const n = Math.max(1, Math.floor(total));
  const chipW = boxW * 0.42;
  const minX = chipW / 2 + boxW * 0.06;
  const maxX = n * boxW - chipW / 2 - boxW * 0.06;
  const target = (Math.min(n, Math.max(1, Math.floor(winner))) - 0.5) * boxW;
  // Enough full spans for the run to build up a head of steam, then the
  // offset that lands the chip on the winner, still travelling left to right.
  const laps = n + 2;
  const theta = target - minX + 2 * laps * (maxX - minX);
  return { chipW, minX, maxX, x0: minX, target, theta, seconds: Math.min(24, 7 + n * 1.5) };
}

/** Where the chip's centre is `t` seconds into the flight, in wall pixels. */
export function drawChipX(plan: DrawPlan, t: number): number {
  const u = Math.min(1, Math.max(0, t / plan.seconds));
  // easeInOutCubic: the crawl at each end is what hides the moment the
  // message reached each screen, and stops the chip instead of snatching it.
  const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
  return pingpong(plan.x0 + plan.theta * e, plan.minX, plan.maxX);
}

/** Fold a position onto the span with a triangle wave: L→R, R→L, forever. */
function pingpong(x: number, min: number, max: number): number {
  const span = max - min;
  const m = (((x - min) % (2 * span)) + 2 * span) % (2 * span);
  return m <= span ? min + m : max - (m - span);
}
