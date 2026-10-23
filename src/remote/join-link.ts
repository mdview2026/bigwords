import { go } from '../nav';
import { sitePath } from '../paths';
import type { SiteRoute } from '../paths';
import { VIEWER_RETURN_KEY } from '../viewer';
import { noteWallStart } from '../wall';
import { deviceId } from './device-id';
import { openMqtt, publishAll, type MqttConnection } from './mqtt';
import { blackFragment, commandWall, decodeCommand, decodeInfo, DEFAULT_BROKER, playerInfoTopic, type PlayerInfo } from './protocol';
import { clearJoin, encodeJoin, readJoin, roomJoinTopic, roomPlayTopic, writeJoin, type JoinChoice } from './room';

/**
 * This tab's link to a live room: the join page's half of the new pairing
 * direction. The player page's link (player-link.ts) waits to be scanned; this
 * one goes out and joins, then plays whatever the host broadcasts.
 */

export type JoinStatus = 'idle' | 'connecting' | 'online' | 'offline';

export interface JoinState {
  room: string | null;
  status: JoinStatus;
  /** The number the host gave this screen, or null while it has none. */
  info: PlayerInfo | null;
}

const listeners = new Set<(state: JoinState) => void>();
const pendingListeners = new Set<(playing: boolean) => void>();
let connection: MqttConnection | null = null;
let generation = 0;
let held = false;
let choice: JoinChoice | null = readJoin();
let status: JoinStatus = 'idle';
let info: PlayerInfo | null = null;
/** A room command that arrived before the screen took over. */
let pending: string | null = null;

function state(): JoinState {
  return { room: choice?.room ?? null, status, info };
}

function emit(next: JoinStatus, nextInfo: PlayerInfo | null = info): void {
  status = next;
  info = nextInfo;
  for (const listener of listeners) listener(state());
}

export function watchJoin(listener: (state: JoinState) => void): () => void {
  listeners.add(listener);
  listener(state());
  return () => listeners.delete(listener);
}

/** True when the room is already playing and this screen has not taken it. */
export function watchPending(listener: (playing: boolean) => void): () => void {
  pendingListeners.add(listener);
  listener(pending !== null);
  return () => pendingListeners.delete(listener);
}

function emitPending(playing: boolean): void {
  for (const listener of pendingListeners) listener(playing);
}

const ACCEPTED_KEY = 'bw-accepted';

/**
 * True once this tab's screen has taken over this session: the room then
 * drives it directly again. sessionStorage, so refreshes and trips through
 * the home page keep it; only a fully new tab starts over.
 */
export function hasAcceptedControl(): boolean {
  try {
    return sessionStorage.getItem(ACCEPTED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAccepted(): void {
  try {
    sessionStorage.setItem(ACCEPTED_KEY, '1');
  } catch {
    // Blocked storage: every play then waits for another takeover.
  }
}

function forgetAccepted(): void {
  try {
    sessionStorage.removeItem(ACCEPTED_KEY);
  } catch {
    // Ignore; a stale flag only means one fewer tap.
  }
}

/** Join (or rejoin) a room. The room and its join moment persist per tab, so a reload keeps this screen's place in line. */
export function joinRoom(room: string, broker?: string): void {
  if (choice && choice.room !== room) evict(choice);
  choice = writeJoin(room, broker);
  pending = null;
  emitPending(false);
  for (const listener of listeners) listener(state());
  held = true;
  generation += 1;
  connection?.close();
  connection = null;
  void run(generation);
}

/** Leave the room from the join page: drop the retained announcement, then forget the room on this tab. */
export function leaveRoom(): void {
  const gone = choice;
  if (gone) evict(gone);
  forget();
}

/**
 * Drop this screen's retained announcement. Sent on the link we are about to
 * close when we can — inside one socket the tombstone cannot land after a newer
 * announcement — and on a short-lived connection when that link is down.
 */
function evict(at: JoinChoice): void {
  const topic = roomJoinTopic(at.room, deviceId());
  const live = connection;
  connection = null;
  if (live && status === 'online') {
    live.publish(topic, '', true);
    live.close();
    return;
  }
  live?.close();
  void publishAll([{ broker: at.broker ?? DEFAULT_BROKER, topic, payload: '', retain: true }]).catch(() => {
    // The host still holds the announcement; its own list, or a later
    // session end, clears it.
  });
}

function forget(): void {
  choice = null;
  clearJoin();
  pending = null;
  forgetAccepted();
  emitPending(false);
  generation += 1;
  connection?.close();
  connection = null;
  emit('idle', null);
}

/** The host ended the show: forget the room (the host already cleared what the broker kept) and come home. */
function sessionOver(): void {
  forget();
  go('/?role=join');
}

function returnIsJoin(): boolean {
  const saved = sessionStorage.getItem(VIEWER_RETURN_KEY);
  if (!saved) return false;
  try {
    return new URL(saved, location.href).searchParams.get('role') === 'join';
  } catch {
    return false;
  }
}

/**
 * Keep the room link alive while the join page or its playback is on screen.
 * Leaving both means leaving the room: the announcement goes, or a browser
 * closed afterwards would linger on the host's list with no will to clear it.
 * The join itself stays in store, so coming back keeps this screen's place.
 */
export function syncJoinLink(route: SiteRoute): void {
  const wants = choice !== null && (route === 'join' || (route === 'viewer' && returnIsJoin()));
  if (wants) {
    if (!held) {
      held = true;
      void run(++generation);
    }
    return;
  }
  held = false;
  generation += 1;
  if (choice) evict(choice);
  else connection?.close();
  connection = null;
  if (status !== 'idle') emit('idle');
}

function joinReturnHref(): string {
  return new URL(sitePath('/?role=join'), location.href).href;
}

/** Take over this screen: show what the room is playing, or wait on black. */
export function acceptControl(): void {
  const fragment = pending ?? blackFragment();
  pending = null;
  emitPending(false);
  rememberAccepted();
  if (commandWall(fragment)) noteWallStart();
  sessionStorage.setItem(VIEWER_RETURN_KEY, joinReturnHref());
  go(`/#${fragment}`);
}

function showFragment(fragment: string): void {
  const onViewer = location.hash.length > 1 && !new URLSearchParams(location.search).get('e');
  if (!onViewer && !hasAcceptedControl()) {
    // The waiting page is up and this session has not taken over yet: the
    // sign waits. After the first takeover, the room drives the screen directly.
    pending = fragment;
    emitPending(true);
    return;
  }
  sessionStorage.setItem(VIEWER_RETURN_KEY, joinReturnHref());
  if (commandWall(fragment)) noteWallStart();
  const hash = `#${fragment}`;
  if (location.hash === hash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function run(token: number): Promise<void> {
  while (held && choice && token === generation) {
    const at = choice;
    emit('connecting');
    try {
      await listen(at, token);
    } catch {
      // The next loop retries.
    }
    if (!held || choice === null || token !== generation) return;
    emit('offline');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function listen(at: JoinChoice, token: number): Promise<void> {
  const id = deviceId();
  return new Promise((resolve) => {
    openMqtt({
      url: at.broker ?? DEFAULT_BROKER,
      clientId: `j${id}-${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      // If this tab dies without a DISCONNECT, the broker publishes the
      // tombstone for us: the host drops the screen and closes the gap.
      will: { topic: roomJoinTopic(at.room, id), payload: '', retain: true },
      onConnect() {
        if (token !== generation) return;
        emit('online');
      },
      onMessage(message) {
        if (token !== generation) return;
        if (message.topic === playerInfoTopic(id)) {
          emit(status, decodeInfo(message.payload));
          return;
        }
        if (message.topic !== roomPlayTopic(at.room)) return;
        if (message.payload === '') {
          // An emptied topic only reaches current subscribers, so this is the
          // host's curtain call, not a stale room.
          sessionOver();
          return;
        }
        const fragment = decodeCommand(message.payload);
        if (!fragment) return;
        // Every screen on the room gets the message within a moment of the
        // others, so counting from display keeps their motion in step.
        showFragment(fragment);
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
        opened.subscribe(roomPlayTopic(at.room));
        opened.subscribe(playerInfoTopic(id));
        // Re-announcing on every connect heals a tombstone an earlier blip
        // left behind, and hands a late joiner its slice of the numbering.
        opened.publish(roomJoinTopic(at.room, id), encodeJoin(id, at.t), true);
      })
      .catch(() => resolve());
  });
}
