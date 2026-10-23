import { parseFragment, serializeFragment } from '../state/fragment';
import { PARAM_ORDER, pruneDefaults } from '../state/params';
import { formatWall, parseWall, type Wall } from '../wall';

/**
 * Our MQTT over WebSocket broker. The player puts this in the QR code, and the
 * controller uses whatever the code says. Self-hosted builds override it with
 * the VITE_MQTT_URL build variable (see README); unset, it points at the
 * public instance's broker.
 */
export const DEFAULT_BROKER = import.meta.env.VITE_MQTT_URL || 'wss://mqtt.mdview.cn/mqtt';

/** Broker credentials live in local_settings.ts, which is gitignored; see local_settings.example.ts. */
export { MQTT_PASSWORD, MQTT_USERNAME } from './local_settings';

const ID_RE = /^[a-f0-9]{16}$/;
/** Longest display fragment a command may carry. */
export const MAX_FRAGMENT = 4000;
/** Most screens one controller may drive, and so the largest slot number. */
export const MAX_SLOTS = 20;

export interface Pairing {
  id: string;
  broker: string;
}

/** Where a screen sits in the controller's list: its number, and how many there are. */
export interface PlayerInfo {
  slot: number;
  total: number;
}

/** Shown by the controller: screens are placed left to right in numbered order. */
export const WALL_LEAD = '按编号从左到右摆放屏幕，编号会显示在每台屏幕上。两块以上会拼成一块大牌子。';
export function playerTopic(id: string): string {
  return `bw/v1/${id}/play`;
}

/** Retained topic carrying the screen's number. A player reads it as soon as it connects. */
export function playerInfoTopic(id: string): string {
  return `bw/v1/${id}/info`;
}

export function isPlayerId(value: string): boolean {
  return ID_RE.test(value);
}

export function isBrokerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'wss:' || url.protocol === 'ws:') && url.host.length > 0;
  } catch {
    return false;
  }
}

/** Text stored in the player's QR code. */
export function pairingText(id: string, broker: string = DEFAULT_BROKER): string {
  return JSON.stringify({ k: 'bw', v: 1, id, url: broker });
}

/** Read a scanned code or a typed id. A bare id uses the default broker. */
export function parsePairing(text: string): Pairing | null {
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, '').toLowerCase();
  if (isPlayerId(compact)) return { id: compact, broker: DEFAULT_BROKER };
  try {
    const data = JSON.parse(trimmed) as { k?: unknown; v?: unknown; id?: unknown; url?: unknown };
    if (data.k !== 'bw' || data.v !== 1) return null;
    if (typeof data.id !== 'string' || !isPlayerId(data.id)) return null;
    if (typeof data.url !== 'string' || !isBrokerUrl(data.url)) return null;
    return { id: data.id, broker: data.url };
  } catch {
    return null;
  }
}

export function encodeCommand(fragment: string): string {
  return JSON.stringify({ v: 1, fragment });
}

/** The display fragment inside a control message, or null when the message is not ours. */
export function decodeCommand(raw: string): string | null {
  try {
    const data = JSON.parse(raw) as { v?: unknown; fragment?: unknown };
    if (data.v !== 1 || typeof data.fragment !== 'string') return null;
    const fragment = data.fragment;
    if (fragment.length < 1 || fragment.length > MAX_FRAGMENT) return null;
    if (fragment.includes('\0')) return null;
    return fragment;
  } catch {
    return null;
  }
}

export function encodeInfo(info: PlayerInfo): string {
  return JSON.stringify({ v: 1, slot: info.slot, total: info.total });
}

/** The numbering inside an info message, or null when the message is not ours or clears the number. */
export function decodeInfo(raw: string): PlayerInfo | null {
  try {
    const data = JSON.parse(raw) as { v?: unknown; slot?: unknown; total?: unknown };
    if (data.v !== 1) return null;
    const { slot, total } = data;
    if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(total)) return null;
    if ((slot as number) < 1 || (total as number) < 1) return null;
    if ((slot as number) > (total as number) || (total as number) > MAX_SLOTS) return null;
    return { slot: slot as number, total: total as number };
  } catch {
    return null;
  }
}

/** The wall slice a controller's command asks this screen to show, or null when it is a sign on its own. */
export function commandWall(fragment: string): Wall | null {
  return parseWall(parseFragment(fragment).params.wall);
}

export function formatPlayerId(id: string): string {
  return id.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * The same sign, with one screen's slice of it written in. Two screens or
 * more make a wall: each is told which part of the message is its own, and
 * they all count their motion from the moment the message arrives.
 */
export function wallFragment(fragment: string, slot: number, total: number): string {
  if (total < 2 || slot < 1 || slot > total) return fragment;
  const state = parseFragment(fragment);
  state.params.wall = formatWall({ slot, total });
  return serializeFragment({ message: state.message, params: pruneDefaults(state.params) }, PARAM_ORDER);
}

/**
 * One screen's slice of a lucky draw. Every screen shows its own number big
 * and flies the chip across the wall; the seed is the same on all of them, so
 * they all work out the same winner and the same flight. The base colours are
 * fixed so the chip's gold reads wherever the draw is sent from.
 */
export function drawFragment(slot: number, total: number, seed: number): string {
  const params: Record<string, string> = {
    anim: 'draw',
    draw: String(Math.max(0, Math.floor(seed))),
    bg: '000000',
    fg: 'ffffff',
    font: '4',
    wall: total >= 2 && slot >= 1 && slot <= total ? formatWall({ slot, total }) : '',
  };
  return serializeFragment({ message: `**${Math.max(1, Math.floor(slot))}**`, params: pruneDefaults(params) }, PARAM_ORDER);
}

/**
 * The screen with nothing on it. 停止播放 sends it to every screen, and a
 * player that has accepted control waits on it until the next command lands.
 */
export function blackFragment(): string {
  return serializeFragment({ message: '', params: { bg: '000000' } }, PARAM_ORDER);
}
