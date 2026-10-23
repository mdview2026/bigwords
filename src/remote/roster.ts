import { isBrokerUrl, isPlayerId, MAX_SLOTS, type Pairing } from './protocol';

const STORAGE_KEY = 'bw-roster';
const MAX_PLAYERS = MAX_SLOTS;

/** A player as stored: the list order is what numbers the screens. */
type Row = Pairing & { on: boolean };

export interface PairedPlayer extends Row {
  /** 1-based place in the list, and the number the screen shows. */
  slot: number;
}

function sanitize(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  const out: Row[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; broker?: unknown; on?: unknown };
    if (typeof row.id !== 'string' || !isPlayerId(row.id)) continue;
    if (typeof row.broker !== 'string' || !isBrokerUrl(row.broker)) continue;
    if (out.some((player) => player.id === row.id)) continue;
    out.push({ id: row.id, broker: row.broker, on: row.on !== false });
    if (out.length >= MAX_PLAYERS) break;
  }
  return out;
}

/** Slots are always the list order, so removing a player closes the gap. */
function withSlots(rows: Row[]): PairedPlayer[] {
  return rows.map((row, index) => ({ ...row, slot: index + 1 }));
}

export function readRoster(): PairedPlayer[] {
  try {
    return withSlots(sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')));
  } catch {
    return [];
  }
}

export function writeRoster(players: PairedPlayer[]): void {
  try {
    // Only the order is stored; the numbers are derived from it.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(players)));
  } catch {
    // Private mode can refuse storage. The list lasts for this page only.
  }
}

/** Add a player, or refresh one already known. New players join the end, so scanning in order numbers them in order. */
export function upsertPlayer(pairing: Pairing): PairedPlayer[] {
  const players = readRoster();
  if (players.some((player) => player.id === pairing.id)) {
    const next = players.map((player) => (player.id === pairing.id ? { ...player, broker: pairing.broker } : player));
    writeRoster(next);
    return next;
  }
  const next = withSlots(sanitize([...players, { ...pairing, on: true }]));
  writeRoster(next);
  return next;
}

export function removePlayer(id: string): PairedPlayer[] {
  const next = withSlots(sanitize(readRoster().filter((player) => player.id !== id)));
  writeRoster(next);
  return next;
}

export function setPlayerOn(id: string, on: boolean): PairedPlayer[] {
  const next = readRoster().map((player) => (player.id === id ? { ...player, on } : player));
  writeRoster(next);
  return next;
}

/** Move a player one place up (-1) or down (+1). The numbers follow the new order. */
export function movePlayer(id: string, delta: number): PairedPlayer[] {
  const players = readRoster();
  const from = players.findIndex((player) => player.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= players.length) return players;
  const swapped = [...players];
  [swapped[from], swapped[to]] = [swapped[to], swapped[from]];
  const next = withSlots(sanitize(swapped));
  writeRoster(next);
  return next;
}
