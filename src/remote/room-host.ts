import { openMqtt, publishAll, type MqttConnection } from './mqtt';
import { decodeCommand, DEFAULT_BROKER, encodeCommand, encodeInfo, playerInfoTopic } from './protocol';
import {
  clearStaged,
  decodeJoin,
  orderedMembers,
  roomJoinFilter,
  roomJoinTopic,
  roomPlayTopic,
  type RoomMember,
} from './room';

/**
 * The host's half of a live room: one kept-open connection that collects join
 * announcements, numbers the screens by join order, and broadcasts the sign.
 * Everything the screens need is retained on the broker, so a refreshed host
 * page rebuilds the whole room — members, numbering, live content — by simply
 * connecting again.
 */

export type HostStatus = 'offline' | 'connecting' | 'online';

export interface HostState {
  room: string | null;
  status: HostStatus;
  /** The room's screens in join order, numbered. Screens past the cap are left out. */
  members: RoomMember[];
  /** Screens past the cap: joined, but the room numbers at most MAX_SLOTS. */
  extra: number;
  /** The fragment now playing across the room, or null between broadcasts. */
  live: string | null;
}

const listeners = new Set<(state: HostState) => void>();
let connection: MqttConnection | null = null;
let generation = 0;
let held = false;
let room: string | null = null;
let status: HostStatus = 'offline';
let times = new Map<string, number>();
let numbered = new Set<string>();
let live: string | null = null;
let numberTimer = 0;

function state(): HostState {
  const members = orderedMembers(times);
  return { room, status, members, extra: times.size - members.length, live };
}

function emit(): void {
  for (const listener of listeners) listener(state());
}

export function watchHost(listener: (state: HostState) => void): () => void {
  listeners.add(listener);
  listener(state());
  return () => listeners.delete(listener);
}

/** Host a room. Idempotent; hosting a different room switches and starts clean. */
export function startHost(next: string): void {
  if (room === next && held) return;
  room = next;
  times = new Map();
  numbered = new Set();
  live = null;
  clearTimeout(numberTimer);
  for (const listener of listeners) listener(state());
  generation += 1;
  connection?.close();
  connection = null;
  held = true;
  void run(generation);
}

/** Leave the host page. The graceful disconnect keeps every retained message, so the room survives. */
export function stopHost(): void {
  held = false;
  generation += 1;
  clearTimeout(numberTimer);
  connection?.close();
  connection = null;
  room = null;
  times = new Map();
  numbered = new Set();
  live = null;
  emit();
}

async function run(token: number): Promise<void> {
  while (held && room !== null && token === generation) {
    const at = room;
    status = 'connecting';
    emit();
    try {
      await listen(at, token);
    } catch {
      // The next loop retries.
    }
    if (!held || room === null || token !== generation) return;
    status = 'offline';
    emit();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function listen(at: string, token: number): Promise<void> {
  return new Promise((resolve) => {
    openMqtt({
      url: DEFAULT_BROKER,
      // No will: a host that dies just stops answering; the retained room
      // state stands until someone hosts the code again.
      clientId: `h${at}-${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      onConnect() {
        if (token !== generation) return;
        status = 'online';
        emit();
        scheduleNumbering();
      },
      onMessage(message) {
        if (token !== generation || room !== at) return;
        const prefix = `bw/v1/r/${at}/j/`;
        if (message.topic.startsWith(prefix) && message.topic.length > prefix.length) {
          const id = message.topic.slice(prefix.length);
          // A tombstone empties the topic; an announcement fills it. Retained
          // replays and live joins arrive here by the same path.
          const join = decodeJoin(message.payload);
          if (join && join.id === id) times.set(id, join.t);
          else times.delete(id);
          scheduleNumbering();
          return;
        }
        if (message.topic !== roomPlayTopic(at)) return;
        const fragment = message.payload === '' ? null : decodeCommand(message.payload);
        live = fragment;
        emit();
      },
      onClose() {
        connection = null;
        resolve();
      },
      onError() {
        connection?.close();
      },
    })
      .then((opened) => {
        if (token !== generation) {
          opened.close();
          return;
        }
        connection = opened;
        // The retained announcements rebuild the members after a refresh, and
        // the retained broadcast says what (if anything) is playing.
        opened.subscribe(roomJoinFilter(at));
        opened.subscribe(roomPlayTopic(at));
      })
      .catch(() => resolve());
  });
}

/**
 * Retell every screen its number. Debounced, because the broker replays all
 * retained announcements at once after a subscribe and joins arrive in
 * flurries. Published on one connection in list order, so slot 1 is told first.
 */
function scheduleNumbering(): void {
  clearTimeout(numberTimer);
  numberTimer = window.setTimeout(() => {
    if (!held || !connection) return;
    const members = orderedMembers(times);
    const seen = new Set<string>();
    for (const member of members) {
      seen.add(member.id);
      connection.publish(playerInfoTopic(member.id), encodeInfo({ slot: member.slot, total: members.length }), true);
    }
    for (const id of numbered) {
      if (!seen.has(id)) connection.publish(playerInfoTopic(id), '', true);
    }
    numbered = seen;
    emit();
  }, 400);
}

/** Broadcast a fragment to the whole room, retained: playing screens switch at once, later joiners catch up. */
export function broadcastLive(fragment: string): Promise<void> {
  if (!room) return Promise.reject(new Error('not hosting'));
  live = fragment;
  emit();
  const payload = encodeCommand(fragment);
  if (connection && status === 'online') {
    connection.publish(roomPlayTopic(room), payload, true);
    // QoS 0 sends nothing back, so allow a beat for the socket before calling it done.
    return new Promise((resolve) => setTimeout(resolve, 250));
  }
  return publishAll([{ broker: DEFAULT_BROKER, topic: roomPlayTopic(room), payload, retain: true }]);
}

/** End the show: clear the broadcast and the numbering, evict the announcements, forget the staged fragment. */
export function endSession(): Promise<void> {
  const at = room;
  if (!at) return Promise.resolve();
  // Every announcement goes, over-cap screens included, or a later host would
  // rebuild them as ghosts.
  const ids = [...times.keys()];
  const items = [
    { broker: DEFAULT_BROKER, topic: roomPlayTopic(at), payload: '', retain: true },
    ...ids.flatMap((id) => [
      { broker: DEFAULT_BROKER, topic: playerInfoTopic(id), payload: '', retain: true },
      { broker: DEFAULT_BROKER, topic: roomJoinTopic(at, id), payload: '', retain: true },
    ]),
  ];
  times = new Map();
  numbered = new Set();
  live = null;
  clearStaged();
  emit();
  return publishAll(items);
}
