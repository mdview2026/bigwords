import { describe, expect, it } from 'vitest';
import { parseFragment } from '../src/state/fragment';
import { buildConnect, buildPublish, readPackets } from '../src/remote/mqtt';
import { deviceId, inAppShell } from '../src/remote/device-id';
import { movePlayer, removePlayer, upsertPlayer } from '../src/remote/roster';
import {
  blackFragment,
  commandWall,
  decodeCommand,
  decodeInfo,
  encodeCommand,
  encodeInfo,
  formatPlayerId,
  isBrokerUrl,
  isPlayerId,
  MQTT_PASSWORD,
  MQTT_USERNAME,
  parsePairing,
  playerInfoTopic,
  playerTopic,
  wallFragment,
} from '../src/remote/protocol';

const ID = '0123456789abcdef';
const OTHER = 'fedcba9876543210';
const THIRD = '0011223344556677';

describe('player pairing', () => {
  it('accepts a bare id or a qr payload', () => {
    expect(parsePairing(`  ${ID}  `)).toEqual({ id: ID, broker: 'wss://mqtt.mdview.cn/mqtt' });
    expect(parsePairing('0123 4567 89AB cdef')).toEqual({ id: ID, broker: 'wss://mqtt.mdview.cn/mqtt' });
    expect(parsePairing(JSON.stringify({ k: 'bw', v: 1, id: ID, url: 'wss://example.test/mqtt' }))).toEqual({
      id: ID,
      broker: 'wss://example.test/mqtt',
    });
    expect(parsePairing(JSON.stringify({ k: 'bw', v: 1, id: ID, url: 'https://example.test/mqtt' }))).toBeNull();
    expect(parsePairing('not-a-code')).toBeNull();
    expect(parsePairing(JSON.stringify({ k: 'other', v: 1, id: ID, url: 'wss://example.test/mqtt' }))).toBeNull();
  });

  it('encodes a display fragment and rejects a bad command', () => {
    expect(decodeCommand(encodeCommand('你好&bg=111'))).toBe('你好&bg=111');
    expect(decodeCommand('{"v":1,"fragment":""}')).toBeNull();
    expect(decodeCommand(`{"v":1,"fragment":"${'x'.repeat(4001)}"}`)).toBeNull();
    expect(decodeCommand('{"v":1,"fragment":"a\\u0000b"}')).toBeNull();
    expect(decodeCommand('{"v":2,"fragment":"hi"}')).toBeNull();
    expect(playerTopic(ID)).toBe(`bw/v1/${ID}/play`);
    expect(playerInfoTopic(ID)).toBe(`bw/v1/${ID}/info`);
    expect(formatPlayerId(ID)).toBe('0123 4567 89ab cdef');
    expect(isBrokerUrl('ws://127.0.0.1:1883/mqtt')).toBe(true);
  });

  it('round-trips a screen number and rejects a bad one', () => {
    expect(decodeInfo(encodeInfo({ slot: 2, total: 3 }))).toEqual({ slot: 2, total: 3 });
    // An empty payload is the tombstone that clears a removed screen's number.
    expect(decodeInfo('')).toBeNull();
    expect(decodeInfo(JSON.stringify({ v: 1, slot: 0, total: 3 }))).toBeNull();
    expect(decodeInfo(JSON.stringify({ v: 1, slot: 4, total: 3 }))).toBeNull();
    expect(decodeInfo(JSON.stringify({ v: 1, slot: 1.5, total: 3 }))).toBeNull();
    expect(decodeInfo(JSON.stringify({ v: 2, slot: 1, total: 3 }))).toBeNull();
  });

  it('gives each screen of a wall its own slice of the sign', () => {
    const first = wallFragment('HELLO&anim=scroll&bg=111', 1, 3);
    const second = wallFragment('HELLO&anim=scroll&bg=111', 2, 3);
    expect(commandWall(first)).toEqual({ slot: 1, total: 3 });
    expect(commandWall(second)).toEqual({ slot: 2, total: 3 });
    // The message and the other settings are untouched, and the slice is
    // written back in the fragment's own key order.
    expect(first).toBe('HELLO&bg=111&anim=scroll&wall=1/3');
    expect(second).toBe('HELLO&bg=111&anim=scroll&wall=2/3');
    // A message with spaces and Chinese survives the trip.
    expect(commandWall(wallFragment('你好 世界&bg=111', 3, 3))).toEqual({ slot: 3, total: 3 });
    // A sign on its own is not a wall, and a bad slice changes nothing.
    expect(commandWall('HELLO&wall=1/1')).toBeNull();
    expect(commandWall('HELLO')).toBeNull();
    expect(wallFragment('HELLO&bg=111', 2, 1)).toBe('HELLO&bg=111');
    expect(wallFragment('HELLO&bg=111', 4, 3)).toBe('HELLO&bg=111');
  });
});

describe('the waiting screen', () => {
  it('is black and empty, ready for the next command', () => {
    const seen = parseFragment(blackFragment());
    expect(seen.message).toBe('');
    expect(seen.params.bg).toBe('000000');
  });
});

describe('browser player ids', () => {
  it('gives each page its own id, keeping one across reloads', () => {
    localStorage.clear();
    sessionStorage.clear();
    // A page from before the per-page upgrade keeps the id it was paired
    // with, and frees the old per-browser copy so other pages fork their own.
    localStorage.setItem('bw-device-id', ID);
    expect(deviceId()).toBe(ID);
    expect(localStorage.getItem('bw-device-id')).toBeNull();
    expect(sessionStorage.getItem('bw-device-id')).toBe(ID);
    // The same page, reloaded: the id survives.
    expect(deviceId()).toBe(ID);
    // A page opened later of the same browser starts fresh.
    sessionStorage.clear();
    const fresh = deviceId();
    expect(isPlayerId(fresh)).toBe(true);
    expect(fresh).not.toBe(ID);
    expect(isPlayerId(deviceId())).toBe(true);
  });

  it('knows the app shell, and lets its id win over the page store', () => {
    expect(inAppShell()).toBe(false);
    const host = window as Window & { BigwordsAndroid?: { getDeviceId?: () => string } };
    sessionStorage.setItem('bw-device-id', OTHER);
    host.BigwordsAndroid = { getDeviceId: () => ID };
    try {
      // Inside the app the button that needs a browser Fullscreen API hides itself.
      expect(inAppShell()).toBe(true);
      // The device's own id wins over anything the page stored.
      expect(deviceId()).toBe(ID);
    } finally {
      delete host.BigwordsAndroid;
      sessionStorage.removeItem('bw-device-id');
    }
    expect(inAppShell()).toBe(false);
  });
});

describe('player roster', () => {
  it('numbers screens in the order they were added', () => {
    localStorage.clear();
    expect(upsertPlayer({ id: ID, broker: 'wss://a.test/mqtt' }).map((p) => p.slot)).toEqual([1]);
    expect(upsertPlayer({ id: OTHER, broker: 'wss://a.test/mqtt' }).map((p) => p.slot)).toEqual([1, 2]);
    expect(upsertPlayer({ id: THIRD, broker: 'wss://a.test/mqtt' }).map((p) => p.slot)).toEqual([1, 2, 3]);
    // Re-adding a known screen keeps its place instead of making a duplicate.
    expect(upsertPlayer({ id: ID, broker: 'wss://a.test/mqtt' }).map((p) => p.id)).toEqual([ID, OTHER, THIRD]);
  });

  it('renumbers after a move or a removal', () => {
    localStorage.clear();
    for (const id of [ID, OTHER, THIRD]) upsertPlayer({ id, broker: 'wss://a.test/mqtt' });
    expect(movePlayer(THIRD, -1).map((p) => `${p.slot}:${p.id}`)).toEqual([`1:${ID}`, `2:${THIRD}`, `3:${OTHER}`]);
    expect(movePlayer(ID, -1).map((p) => p.id)).toEqual([ID, THIRD, OTHER]);
    expect(removePlayer(THIRD).map((p) => `${p.slot}:${p.id}`)).toEqual([`1:${ID}`, `2:${OTHER}`]);
  });
});

describe('mqtt packets', () => {
  it('reads a connack and a qos 0 publish', () => {
    const connack = readPackets(Uint8Array.from([0x20, 0x02, 0x00, 0x00]));
    expect(connack.packets).toEqual([{ kind: 'connack', returnCode: 0 }]);
    expect(connack.rest).toHaveLength(0);

    const published = buildPublish('bw/v1/x/play', '{"v":1}');
    const parsed = readPackets(published);
    expect(parsed.packets[0]).toMatchObject({ kind: 'publish', topic: 'bw/v1/x/play', payload: '{"v":1}' });
    // The retain bit is set for the numbering topic, so a screen that connects later still gets it.
    expect(buildPublish('bw/v1/x/info', '{}', true)[0]).toBe(0x31);
    expect(buildPublish('bw/v1/x/info', '{}')[0]).toBe(0x30);

    const split = readPackets(published.subarray(0, 3));
    expect(split.packets).toHaveLength(0);
    expect(split.rest).toHaveLength(3);
    const rest = new Uint8Array(split.rest.length + published.length - 3);
    rest.set(split.rest, 0);
    rest.set(published.subarray(3), split.rest.length);
    expect(readPackets(rest).packets[0]?.kind).toBe('publish');
  });

  it('starts a clean mqtt 3.1.1 session with credentials', () => {
    const packet = buildConnect('p0123456789abcdef', 30);
    expect(packet[0]).toBe(0x10);
    expect(packet[8]).toBe(0x04); // mqtt 3.1.1
    expect(packet[9]).toBe(0xc2); // clean session + username + password flags
    const text = new TextDecoder().decode(packet);
    expect(text).toContain('MQTT');
    expect(text).toContain('p0123456789abcdef');
    expect(text).toContain(MQTT_USERNAME);
    expect(text).toContain(MQTT_PASSWORD);
  });
});
