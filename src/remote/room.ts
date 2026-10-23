import { DEFAULT_BROKER, isBrokerUrl, isPlayerId, MAX_FRAGMENT, MAX_SLOTS } from './protocol';

/**
 * A live room: the host shows a code, screens join by scanning or typing it,
 * and everyone plays what the host broadcasts. Unlike a pairing (where the
 * controller collects player ids), the room's members are the retained join
 * announcements on the broker, so any host can rebuild the list.
 */

/** A room code is six digits: short enough to read aloud and type on a TV remote. */
export const ROOM_RE = /^\d{6}$/;

/** The host's room code, in localStorage so a controller keeps its room across visits. */
export const ROOM_KEY = 'bw-host-room';
/** The join page's room, per tab. The stored join moment keeps a screen's place in line across reloads. */
export const JOIN_KEY = 'bw-join';
/** The fragment the editor staged for the room, in localStorage so it survives the host page reloading. */
export const STAGE_KEY = 'bw-staged';

export interface RoomJoin {
  id: string;
  /** When this screen first joined: the room is numbered by this. */
  t: number;
}

export function isRoomCode(value: string): boolean {
  return ROOM_RE.test(value);
}

/** Six random digits. Leading zeros stay: the code is text to type, not a number. */
export function makeRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => String(byte % 10)).join('');
}

/** '482913' → '482 913', grouped for reading across a room. */
export function formatRoomCode(room: string): string {
  return room.length === 6 ? `${room.slice(0, 3)} ${room.slice(3)}` : room;
}

/** The room's shared content. Retained, so a screen that joins late still gets it. */
export function roomPlayTopic(room: string): string {
  return `bw/v1/r/${room}/play`;
}

/** One screen's retained join announcement. An empty payload is the tombstone. */
export function roomJoinTopic(room: string, id: string): string {
  return `bw/v1/r/${room}/j/${id}`;
}

/** Every join announcement of a room. The host subscribes to this one filter. */
export function roomJoinFilter(room: string): string {
  return `bw/v1/r/${room}/j/+`;
}

export function encodeJoin(id: string, t: number): string {
  return JSON.stringify({ v: 1, id, t });
}

/** The announcement inside a join message, or null when it is a tombstone or not ours. */
export function decodeJoin(raw: string): RoomJoin | null {
  if (raw === '') return null;
  try {
    const data = JSON.parse(raw) as { v?: unknown; id?: unknown; t?: unknown };
    if (data.v !== 1) return null;
    if (typeof data.id !== 'string' || !isPlayerId(data.id)) return null;
    if (typeof data.t !== 'number' || !Number.isSafeInteger(data.t) || data.t < 1) return null;
    return { id: data.id, t: data.t };
  } catch {
    return null;
  }
}

/** Text stored in the room's QR code where a URL cannot be used (the portable file build). */
export function roomQrText(room: string, broker: string = DEFAULT_BROKER): string {
  return JSON.stringify({ k: 'bwr', v: 1, room, url: broker });
}

export type RoomInput =
  | { ok: true; room: string; broker: string }
  | { ok: false; reason: 'player-code' | 'bad' };

/**
 * Read a scanned code or a typed room code. A bare six digits uses the default
 * broker. A join URL counts too, so the code the phone's own camera opens and
 * the code this page scans are the same thing. A player pairing is told apart,
 * so scanning the wrong side's code gets an explaining message.
 */
export function parseRoomInput(text: string): RoomInput {
  const compact = text.trim().replace(/[\s-]/g, '');
  if (isRoomCode(compact)) return { ok: true, room: compact, broker: DEFAULT_BROKER };
  if (isPlayerId(compact.toLowerCase())) return { ok: false, reason: 'player-code' };
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const room = new URL(trimmed).searchParams.get('room') ?? '';
      if (isRoomCode(room)) return { ok: true, room, broker: DEFAULT_BROKER };
    } catch {
      // Looked like a URL but is not one.
    }
    return { ok: false, reason: 'bad' };
  }
  try {
    const data = JSON.parse(trimmed) as { k?: unknown; id?: unknown; v?: unknown; room?: unknown; url?: unknown };
    if (data.k === 'bw' || (typeof data.id === 'string' && isPlayerId(data.id))) return { ok: false, reason: 'player-code' };
    if (data.k !== 'bwr' || data.v !== 1) return { ok: false, reason: 'bad' };
    if (typeof data.room !== 'string' || !isRoomCode(data.room)) return { ok: false, reason: 'bad' };
    if (typeof data.url !== 'string' || !isBrokerUrl(data.url)) return { ok: false, reason: 'bad' };
    return { ok: true, room: data.room, broker: data.url };
  } catch {
    return { ok: false, reason: 'bad' };
  }
}

export interface RoomMember {
  id: string;
  t: number;
  /** 1-based place in the room, and the number the screen shows. */
  slot: number;
}

/**
 * The room's screens in join order: by join moment, ties by id. Screens past
 * the cap are left out, so they get no number and the join page says the room
 * may be full instead of everyone past 20 silently sharing a number.
 */
export function orderedMembers(times: Map<string, number>, cap: number = MAX_SLOTS): RoomMember[] {
  return [...times.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, cap)
    .map(([id, t], index) => ({ id, t, slot: index + 1 }));
}

export interface StagedFragment {
  fragment: string;
  t: number;
}

export function readStaged(): StagedFragment | null {
  try {
    const data = JSON.parse(localStorage.getItem(STAGE_KEY) || 'null') as { fragment?: unknown; t?: unknown };
    if (typeof data.fragment !== 'string' || data.fragment.length < 1 || data.fragment.length > MAX_FRAGMENT) return null;
    if (data.fragment.includes('\0')) return null;
    if (typeof data.t !== 'number' || !Number.isSafeInteger(data.t) || data.t < 1) return null;
    return { fragment: data.fragment, t: data.t };
  } catch {
    return null;
  }
}

export function stageFragment(fragment: string): void {
  try {
    localStorage.setItem(STAGE_KEY, JSON.stringify({ fragment, t: Date.now() }));
  } catch {
    // Storage can be blocked. The host page then has nothing to broadcast.
  }
}

export function clearStaged(): void {
  try {
    localStorage.removeItem(STAGE_KEY);
  } catch {
    // Ignore a blocked store.
  }
}

export function readHostRoom(): string | null {
  try {
    const room = localStorage.getItem(ROOM_KEY);
    return room && isRoomCode(room) ? room : null;
  } catch {
    return null;
  }
}

export function writeHostRoom(room: string): void {
  try {
    localStorage.setItem(ROOM_KEY, room);
  } catch {
    // Ignore a blocked store.
  }
}

export interface JoinChoice {
  room: string;
  /** Kept from the first join of this room, so a reload does not move the screen to the end of the line. */
  t: number;
  /** Only the QR of a portable build carries one; typed codes use the stock broker. */
  broker?: string;
}

export function readJoin(): JoinChoice | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(JOIN_KEY) || 'null') as { room?: unknown; t?: unknown; broker?: unknown };
    if (typeof data.room !== 'string' || !isRoomCode(data.room)) return null;
    if (typeof data.t !== 'number' || !Number.isSafeInteger(data.t) || data.t < 1) return null;
    if (data.broker !== undefined && (typeof data.broker !== 'string' || !isBrokerUrl(data.broker))) return null;
    return data.broker === undefined ? { room: data.room, t: data.t } : { room: data.room, t: data.t, broker: data.broker };
  } catch {
    return null;
  }
}

/** Join (or rejoin) a room. Rejoining the room already in store keeps its moment. */
export function writeJoin(room: string, broker?: string): JoinChoice {
  const saved = readJoin();
  const fresh: JoinChoice = { room, t: Date.now(), ...(broker ? { broker } : {}) };
  const choice = saved && saved.room === room ? saved : fresh;
  try {
    sessionStorage.setItem(JOIN_KEY, JSON.stringify(choice));
  } catch {
    // Storage can be blocked. The join then lasts for this page only.
  }
  return choice;
}

export function clearJoin(): void {
  try {
    sessionStorage.removeItem(JOIN_KEY);
  } catch {
    // Ignore a blocked store.
  }
}
