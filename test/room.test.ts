import { describe, expect, it } from 'vitest';
import { buildConnect, readPackets } from '../src/remote/mqtt';
import { DEFAULT_BROKER, MAX_SLOTS, MQTT_PASSWORD } from '../src/remote/protocol';
import {
  clearJoin,
  clearStaged,
  decodeJoin,
  encodeJoin,
  formatRoomCode,
  isRoomCode,
  makeRoomCode,
  orderedMembers,
  parseRoomInput,
  readHostRoom,
  readJoin,
  readStaged,
  roomJoinFilter,
  roomJoinTopic,
  roomPlayTopic,
  roomQrText,
  stageFragment,
  writeHostRoom,
  writeJoin,
} from '../src/remote/room';

const ROOM = '482913';
const ID = '0123456789abcdef';
const OTHER = 'fedcba9876543210';

describe('room codes', () => {
  it('makes and reads six digits, and groups them for reading aloud', () => {
    for (let i = 0; i < 20; i++) expect(isRoomCode(makeRoomCode())).toBe(true);
    expect(makeRoomCode()).not.toBe(makeRoomCode());
    expect(isRoomCode('48291')).toBe(false);
    expect(isRoomCode('4829134')).toBe(false);
    expect(isRoomCode('48291a')).toBe(false);
    expect(formatRoomCode(ROOM)).toBe('482 913');
  });

  it('names the room topics and the qr text', () => {
    expect(roomPlayTopic(ROOM)).toBe('bw/v1/r/482913/play');
    expect(roomJoinTopic(ROOM, ID)).toBe('bw/v1/r/482913/j/0123456789abcdef');
    expect(roomJoinFilter(ROOM)).toBe('bw/v1/r/482913/j/+');
    expect(roomQrText(ROOM)).toBe(JSON.stringify({ k: 'bwr', v: 1, room: ROOM, url: DEFAULT_BROKER }));
  });
});

describe('join announcements', () => {
  it('round-trips an announcement and rejects a bad one', () => {
    expect(decodeJoin(encodeJoin(ID, 1718333000000))).toEqual({ id: ID, t: 1718333000000 });
    // An empty payload is the tombstone a departure leaves behind.
    expect(decodeJoin('')).toBeNull();
    expect(decodeJoin(JSON.stringify({ v: 2, id: ID, t: 1 }))).toBeNull();
    expect(decodeJoin(JSON.stringify({ v: 1, id: 'not-an-id', t: 1 }))).toBeNull();
    expect(decodeJoin(JSON.stringify({ v: 1, id: ID, t: 1.5 }))).toBeNull();
    expect(decodeJoin(JSON.stringify({ v: 1, id: ID, t: 0 }))).toBeNull();
    expect(decodeJoin('not-json')).toBeNull();
  });

  it('numbers the room in join order and stops at the cap', () => {
    const times = new Map<string, number>([
      [ID, 30],
      [OTHER, 10],
    ]);
    expect(orderedMembers(times)).toEqual([
      { id: OTHER, t: 10, slot: 1 },
      { id: ID, t: 30, slot: 2 },
    ]);
    // Same moment: the id breaks the tie, so the order is stable everywhere.
    const tie = new Map<string, number>([
      [OTHER, 10],
      [ID, 10],
    ]);
    expect(orderedMembers(tie).map((m) => m.id)).toEqual([ID, OTHER]);
    const many = new Map<string, number>();
    for (let i = 0; i < MAX_SLOTS + 5; i++) many.set(`${i}`.padStart(16, '0'), i);
    const members = orderedMembers(many);
    expect(members).toHaveLength(MAX_SLOTS);
    expect(members[MAX_SLOTS - 1]?.slot).toBe(MAX_SLOTS);
  });
});

describe('room input', () => {
  it('accepts a bare code, a join URL, and the qr payload', () => {
    expect(parseRoomInput('  482 913 ')).toEqual({ ok: true, room: ROOM, broker: DEFAULT_BROKER });
    expect(parseRoomInput('482-913')).toEqual({ ok: true, room: ROOM, broker: DEFAULT_BROKER });
    expect(parseRoomInput('https://bigwords.cn/?role=join&room=482913')).toEqual({ ok: true, room: ROOM, broker: DEFAULT_BROKER });
    expect(parseRoomInput(roomQrText(ROOM, 'wss://example.test/mqtt'))).toEqual({ ok: true, room: ROOM, broker: 'wss://example.test/mqtt' });
  });

  it('tells a player pairing apart from a room code', () => {
    expect(parseRoomInput(ID)).toEqual({ ok: false, reason: 'player-code' });
    expect(parseRoomInput('0123 4567 89ab cdef')).toEqual({ ok: false, reason: 'player-code' });
    expect(parseRoomInput(JSON.stringify({ k: 'bw', v: 1, id: ID, url: DEFAULT_BROKER }))).toEqual({ ok: false, reason: 'player-code' });
  });

  it('rejects anything that is not a room', () => {
    expect(parseRoomInput('not-a-code')).toEqual({ ok: false, reason: 'bad' });
    expect(parseRoomInput('48291')).toEqual({ ok: false, reason: 'bad' });
    expect(parseRoomInput('https://example.test/')).toEqual({ ok: false, reason: 'bad' });
    expect(parseRoomInput('https://example.test/?room=abc')).toEqual({ ok: false, reason: 'bad' });
    expect(parseRoomInput(JSON.stringify({ k: 'bwr', v: 1, room: '48291', url: DEFAULT_BROKER }))).toEqual({ ok: false, reason: 'bad' });
    expect(parseRoomInput(JSON.stringify({ k: 'bwr', v: 1, room: ROOM, url: 'https://example.test/mqtt' }))).toEqual({ ok: false, reason: 'bad' });
  });
});

describe('room storage', () => {
  it('stages a fragment for the host and guards what it reads back', () => {
    localStorage.clear();
    expect(readStaged()).toBeNull();
    stageFragment('你好&bg=111');
    expect(readStaged()?.fragment).toBe('你好&bg=111');
    localStorage.setItem('bw-staged', JSON.stringify({ fragment: 'x'.repeat(4001), t: 1 }));
    expect(readStaged()).toBeNull();
    localStorage.setItem('bw-staged', JSON.stringify({ fragment: '你好', t: 'soon' }));
    expect(readStaged()).toBeNull();
    clearStaged();
    expect(readStaged()).toBeNull();
  });

  it('keeps a host room and a per-tab join with their moments', () => {
    localStorage.clear();
    sessionStorage.clear();
    expect(readHostRoom()).toBeNull();
    writeHostRoom(ROOM);
    expect(readHostRoom()).toBe(ROOM);
    localStorage.setItem('bw-host-room', '4829');
    expect(readHostRoom()).toBeNull();

    expect(readJoin()).toBeNull();
    const first = writeJoin(ROOM);
    expect(first.room).toBe(ROOM);
    // Rejoining the same room keeps the moment, so the screen keeps its place.
    expect(writeJoin(ROOM).t).toBe(first.t);
    // A different room starts a new moment.
    const second = writeJoin('654321', 'wss://example.test/mqtt');
    expect(second.room).toBe('654321');
    expect(second.broker).toBe('wss://example.test/mqtt');
    expect(second.t).toBeGreaterThanOrEqual(first.t);
    expect(readJoin()).toEqual(second);
    sessionStorage.setItem('bw-join', JSON.stringify({ room: '4829', t: 1 }));
    expect(readJoin()).toBeNull();
    clearJoin();
    expect(readJoin()).toBeNull();
  });
});

describe('connect packets with a will', () => {
  const will = { topic: roomJoinTopic(ROOM, ID), payload: '', retain: true };

  it('stays byte-identical without one', () => {
    expect(buildConnect('p0123456789abcdef', 30)[9]).toBe(0xc2);
  });

  it('carries the tombstone as a retained will, qos 0', () => {
    const packet = buildConnect('p0123456789abcdef', 30, will);
    expect(packet[9]).toBe(0xe6);
    // Field order: clientId, will topic, will payload (empty = two zero bytes), username, password.
    const text = new TextDecoder().decode(packet);
    const clientIdAt = text.indexOf('p0123456789abcdef');
    const topic = roomJoinTopic(ROOM, ID);
    const topicAt = text.indexOf(topic);
    expect(clientIdAt).toBeGreaterThanOrEqual(0);
    expect(topicAt).toBeGreaterThan(clientIdAt);
    // The empty will payload: its two length bytes sit straight after the topic.
    expect(packet[topicAt - 2]).toBe(0x00);
    expect(packet[topicAt - 1]).toBe(topic.length);
    expect(packet[topicAt + topic.length]).toBe(0x00);
    expect(packet[topicAt + topic.length + 1]).toBe(0x00);
    // The password comes from local_settings.ts, so the test reads it rather
    // than hard-coding whatever credential this checkout happens to carry.
    expect(text.indexOf(MQTT_PASSWORD)).toBeGreaterThan(topicAt);
  });

  it('leaves the retain bit off when asked', () => {
    expect(buildConnect('p0123456789abcdef', 30, { ...will, retain: false })[9]).toBe(0xc6);
  });

  it('still parses as mqtt on the wire', () => {
    const packets = readPackets(buildConnect('p0123456789abcdef', 30, will));
    expect(packets.packets).toHaveLength(1);
    expect(packets.rest).toHaveLength(0);
  });
});
