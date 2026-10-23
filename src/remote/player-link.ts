import { go } from '../nav';
import { sitePath } from '../paths';
import type { SiteRoute } from '../paths';
import { VIEWER_RETURN_KEY } from '../viewer';
import { noteWallStart, type Wall } from '../wall';
import { deviceId } from './device-id';
import { openMqtt, type MqttConnection } from './mqtt';
import { blackFragment, commandWall, decodeCommand, decodeInfo, DEFAULT_BROKER, playerInfoTopic, playerTopic, type PlayerInfo } from './protocol';

export type PlayerStatus = 'connecting' | 'online' | 'offline';

const listeners = new Set<(status: PlayerStatus) => void>();
const infoListeners = new Set<(info: PlayerInfo | null) => void>();
const wallListeners = new Set<(wall: Wall | null) => void>();
const pendingListeners = new Set<(playing: boolean) => void>();
let connection: MqttConnection | null = null;
let generation = 0;
let held = false;
let status: PlayerStatus = 'offline';
let info: PlayerInfo | null = null;
let wall: Wall | null = null;
/** A command that arrived before the screen took over. */
let pending: string | null = null;

function emit(next: PlayerStatus): void {
  status = next;
  for (const listener of listeners) listener(next);
}

function emitInfo(next: PlayerInfo | null): void {
  info = next;
  for (const listener of infoListeners) listener(next);
}

/** The wall slice a controller last asked this screen to show. */
function emitWall(next: Wall | null): void {
  wall = next;
  for (const listener of wallListeners) listener(next);
}

/** True when the controller is already playing and this screen has not taken it. */
export function watchPending(listener: (playing: boolean) => void): () => void {
  pendingListeners.add(listener);
  listener(pending !== null);
  return () => pendingListeners.delete(listener);
}

export function playerStatus(): PlayerStatus {
  return status;
}

export function watchPlayerStatus(listener: (status: PlayerStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

/** The number a controller gave this screen, or null when it has none. */
export function playerInfo(): PlayerInfo | null {
  return info;
}

/** This screen's place in a multi-screen sign, or null when it is a sign on its own. */
export function playerWall(): Wall | null {
  return wall;
}

/** Watch the wall slice this screen has been given. */
export function watchPlayerWall(listener: (wall: Wall | null) => void): () => void {
  wallListeners.add(listener);
  listener(wall);
  return () => wallListeners.delete(listener);
}

export function watchPlayerInfo(listener: (info: PlayerInfo | null) => void): () => void {
  infoListeners.add(listener);
  listener(info);
  return () => infoListeners.delete(listener);
}

const WAS_ADDED_KEY = 'bw-was-added';

/** True when a controller numbered this screen on an earlier visit. Lets the page open straight on the joined offer instead of flashing the QR. */
export function wasAdded(): boolean {
  try {
    return localStorage.getItem(WAS_ADDED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAdded(info: PlayerInfo | null): void {
  try {
    localStorage.setItem(WAS_ADDED_KEY, info ? '1' : '0');
  } catch {
    // Storage can be blocked; the page then just shows the QR first.
  }
}

const ACCEPTED_KEY = 'bw-accepted';

/**
 * True once this tab's screen has taken over this session: the controller
 * then drives it directly again, so a double-tap exit is only a peek at the
 * page, not the end of the show. sessionStorage, so refreshes and trips
 * through the home page keep it; only a fully new tab starts over.
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

function returnIsPlayer(): boolean {
  const saved = sessionStorage.getItem(VIEWER_RETURN_KEY);
  if (!saved) return false;
  try {
    return new URL(saved, location.href).searchParams.get('role') === 'player';
  } catch {
    return false;
  }
}

function wantsLink(route: SiteRoute): boolean {
  return route === 'player' || (route === 'viewer' && returnIsPlayer());
}

/** Keep the player's MQTT subscription alive while the QR page or its playback is on screen. */
export function syncPlayerLink(route: SiteRoute): void {
  if (wantsLink(route)) {
    if (!held) {
      held = true;
      void run(++generation);
    }
    return;
  }
  release();
}

function release(): void {
  held = false;
  generation += 1;
  connection?.close();
  connection = null;
  emit('offline');
  emitInfo(null);
  emitWall(null);
  pending = null;
  for (const listener of pendingListeners) listener(false);
}

function playerReturnHref(): string {
  return new URL(sitePath('/?role=player'), location.href).href;
}

/** Take over this screen: show what the controller is playing, or wait on black. */
export function acceptControl(): void {
  const fragment = pending ?? blackFragment();
  pending = null;
  for (const listener of pendingListeners) listener(false);
  rememberAccepted();
  if (commandWall(fragment)) noteWallStart();
  sessionStorage.setItem(VIEWER_RETURN_KEY, playerReturnHref());
  go(`/#${fragment}`);
}

function showFragment(fragment: string): void {
  const onViewer = location.hash.length > 1 && !new URLSearchParams(location.search).get('e');
  if (!onViewer && !hasAcceptedControl()) {
    // The waiting page is up and this session has not taken over yet: the
    // sign waits. After the first takeover, control drives the screen directly.
    pending = fragment;
    for (const listener of pendingListeners) listener(true);
    return;
  }
  sessionStorage.setItem(VIEWER_RETURN_KEY, playerReturnHref());
  if (commandWall(fragment)) noteWallStart();
  const hash = `#${fragment}`;
  if (location.hash === hash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function run(token: number): Promise<void> {
  const id = deviceId();
  while (held && token === generation) {
    emit('connecting');
    try {
      await listen(id, token);
    } catch {
      // The next loop retries.
    }
    if (!held || token !== generation) return;
    emit('offline');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function listen(id: string, token: number): Promise<void> {
  return new Promise((resolve) => {
    openMqtt({
      url: DEFAULT_BROKER,
      // Two pages may share one id (a duplicated tab copies its storage), and
      // the broker drops an older client when ids collide; the suffix keeps
      // both online so a duplicate acts as a screen of its own.
      clientId: `p${id}-${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      onConnect() {
        if (token !== generation) return;
        emit('online');
      },
      onMessage(message) {
        if (token !== generation) return;
        if (message.topic === playerInfoTopic(id)) {
          const info = decodeInfo(message.payload);
          rememberAdded(info);
          // Unnumbering the screen ends its turn at being controlled.
          if (info === null) forgetAccepted();
          emitInfo(info);
          return;
        }
        if (message.topic !== playerTopic(id)) return;
        const fragment = decodeCommand(message.payload);
        if (!fragment) return;
        emitWall(commandWall(fragment));
        // Screens on one wall were all handed the message within a moment of
        // each other, so counting from display keeps their motion in step. A
        // controller sends again to put a screen that drifted back in line.
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
        // The number is a retained message, so it arrives right after subscribing.
        opened.subscribe(playerInfoTopic(id));
        opened.subscribe(playerTopic(id));
      })
      .catch(() => resolve());
  });
}
