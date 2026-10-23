/** A small MQTT 3.1.1 client over a WebSocket. QoS 0 only: the sign can miss a message and the controller can send it again. */

import { MQTT_PASSWORD, MQTT_USERNAME } from './protocol';

export interface IncomingPublish {
  topic: string;
  payload: string;
}

interface Parsed {
  kind: 'connack' | 'publish' | 'suback' | 'pingresp' | 'other';
  topic?: string;
  payload?: string;
  returnCode?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeRemaining(length: number): Uint8Array {
  const out: number[] = [];
  let left = length;
  do {
    let byte = left % 128;
    left = Math.floor(left / 128);
    if (left > 0) byte |= 0x80;
    out.push(byte);
  } while (left > 0);
  return Uint8Array.from(out);
}

function utf8Field(text: string): Uint8Array {
  const body = encoder.encode(text);
  const out = new Uint8Array(2 + body.length);
  out[0] = body.length >> 8;
  out[1] = body.length & 0xff;
  out.set(body, 2);
  return out;
}

function packet(type: number, body: Uint8Array): Uint8Array {
  const rem = encodeRemaining(body.length);
  const out = new Uint8Array(1 + rem.length + body.length);
  out[0] = type;
  out.set(rem, 1);
  out.set(body, 1 + rem.length);
  return out;
}

/** The message the broker publishes for us if the socket dies without a DISCONNECT. */
export interface LastWill {
  topic: string;
  payload: string;
  retain: boolean;
}

export function buildConnect(clientId: string, keepAlive: number, will?: LastWill): Uint8Array {
  // clean session + username + password, plus will (qos 0) when one is given
  const flags = 0x02 | 0x80 | 0x40 | (will ? 0x04 | (will.retain ? 0x20 : 0) : 0);
  const header = Uint8Array.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, flags, keepAlive >> 8, keepAlive & 0xff]);
  const parts: Uint8Array[] = [header, utf8Field(clientId)];
  if (will) parts.push(utf8Field(will.topic), utf8Field(will.payload));
  parts.push(utf8Field(MQTT_USERNAME), utf8Field(MQTT_PASSWORD));
  return packet(0x10, concat(parts));
}

export function buildSubscribe(id: number, topic: string): Uint8Array {
  const head = Uint8Array.from([(id >> 8) & 0xff, id & 0xff]);
  return packet(0x82, concat([head, utf8Field(topic), Uint8Array.of(0)]));
}

/** `retain` keeps the message on the topic, so a screen that reconnects still gets it. */
export function buildPublish(topic: string, payload: string, retain = false): Uint8Array {
  return packet(retain ? 0x31 : 0x30, concat([utf8Field(topic), encoder.encode(payload)]));
}

export function buildPing(): Uint8Array {
  return Uint8Array.of(0xc0, 0x00);
}

function readVarInt(buf: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let mul = 1;
  let index = offset;
  for (let i = 0; i < 4; i++) {
    if (index >= buf.length) return null;
    const byte = buf[index++];
    value += (byte & 0x7f) * mul;
    if ((byte & 0x80) === 0) return { value, next: index };
    mul *= 128;
  }
  return null;
}

function readUtf8(buf: Uint8Array, offset: number): { text: string; next: number } | null {
  if (offset + 2 > buf.length) return null;
  const length = (buf[offset] << 8) | buf[offset + 1];
  const start = offset + 2;
  const end = start + length;
  if (end > buf.length) return null;
  return { text: decoder.decode(buf.subarray(start, end)), next: end };
}

/** Pull complete packets out of a byte stream. `rest` is the incomplete tail. */
export function readPackets(buf: Uint8Array): { packets: Parsed[]; rest: Uint8Array } {
  const packets: Parsed[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const rem = readVarInt(buf, offset + 1);
    if (!rem) break;
    const end = rem.next + rem.value;
    if (end > buf.length) break;
    const type = buf[offset] >> 4;
    const body = buf.subarray(rem.next, end);
    packets.push(parseOne(type, buf[offset], body));
    offset = end;
  }
  const tail = new Uint8Array(buf.length - offset);
  tail.set(buf.subarray(offset));
  return { packets, rest: tail };
}

function parseOne(type: number, first: number, body: Uint8Array): Parsed {
  if (type === 2) return { kind: 'connack', returnCode: body.length > 1 ? body[1] : 0xff };
  if (type === 9) return { kind: 'suback' };
  if (type === 13) return { kind: 'pingresp' };
  if (type !== 3) return { kind: 'other' };
  const topic = readUtf8(body, 0);
  if (!topic) return { kind: 'other' };
  let start = topic.next;
  const qos = (first >> 1) & 0x03;
  if (qos > 0) start += 2;
  if (start > body.length) return { kind: 'other' };
  return { kind: 'publish', topic: topic.text, payload: decoder.decode(body.subarray(start)) };
}

export interface MqttConnection {
  subscribe(topic: string): void;
  publish(topic: string, payload: string, retain?: boolean): void;
  close(): void;
}

export interface MqttOptions {
  url: string;
  clientId: string;
  /** A will fires only on an abrupt end: close() sends DISCONNECT first, which suppresses it. */
  will?: LastWill;
  onConnect?: () => void;
  onMessage?: (message: IncomingPublish) => void;
  onClose?: () => void;
  onError?: (message: string) => void;
}

/** Open one MQTT connection. Resolves after the socket is up; CONNACK arrives later. */
export function openMqtt(options: MqttOptions): Promise<MqttConnection> {
  const keepAlive = 30;
  let socket: WebSocket;
  try {
    socket = new WebSocket(options.url, ['mqtt']);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('无法连接'));
  }
  socket.binaryType = 'arraybuffer';
  let buf: Uint8Array = new Uint8Array(0);
  let alive: ReturnType<typeof setInterval> | undefined;
  let packetId = 1;
  let closed = false;
  let lastRecv = 0;
  const pendingSubs: string[] = [];
  const pendingPubs: { topic: string; payload: string; retain?: boolean }[] = [];
  let connected = false;

  const fail = (message: string) => {
    options.onError?.(message);
    try {
      socket.close();
    } catch {
      // Already closing.
    }
  };

  const send = (bytes: Uint8Array) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    socket.send(copy);
  };

  const connection: MqttConnection = {
    subscribe(topic: string) {
      if (!connected) {
        pendingSubs.push(topic);
        return;
      }
      send(buildSubscribe(packetId++, topic));
    },
    publish(topic: string, payload: string, retain = false) {
      // Queued like subscribes: callers publish right after the socket opens,
      // before the broker has answered the connect.
      if (!connected) {
        pendingPubs.push({ topic, payload, retain });
        return;
      }
      send(buildPublish(topic, payload, retain));
    },
    close() {
      closed = true;
      if (alive) clearInterval(alive);
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(Uint8Array.of(0xe0, 0x00));
        socket.close();
      } catch {
        // Ignore a socket that is already gone.
      }
    },
  };

  socket.addEventListener('open', () => {
    lastRecv = Date.now();
    send(buildConnect(options.clientId, keepAlive, options.will));
    alive = setInterval(() => {
      send(buildPing());
      // A half-open socket (flaky proxy) never fires close: notice the silence instead.
      if (lastRecv > 0 && Date.now() - lastRecv > keepAlive * 1000 * 1.5) fail('心跳超时');
    }, (keepAlive * 1000) / 2);
  });
  socket.addEventListener('message', (event) => {
    lastRecv = Date.now();
    const chunk = new Uint8Array(event.data as ArrayBuffer);
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf, 0);
    merged.set(chunk, buf.length);
    const read = readPackets(merged);
    buf = read.rest;
    for (const item of read.packets) {
      if (item.kind === 'connack') {
        if (item.returnCode !== 0) {
          fail('服务器拒绝了连接');
          return;
        }
        connected = true;
        for (const topic of pendingSubs.splice(0)) send(buildSubscribe(packetId++, topic));
        for (const message of pendingPubs.splice(0)) send(buildPublish(message.topic, message.payload, message.retain));
        options.onConnect?.();
      } else if (item.kind === 'publish' && item.topic != null && item.payload != null) {
        options.onMessage?.({ topic: item.topic, payload: item.payload });
      }
    }
  });
  socket.addEventListener('error', () => {
    if (!closed) options.onError?.('连接中断');
  });
  socket.addEventListener('close', () => {
    if (alive) clearInterval(alive);
    connected = false;
    options.onClose?.();
  });

  return new Promise((resolve, reject) => {
    const onOpen = () => {
      socket.removeEventListener('error', onFail);
      resolve(connection);
    };
    const onFail = () => {
      socket.removeEventListener('open', onOpen);
      reject(new Error('无法连接'));
    };
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onFail, { once: true });
  });
}

/** Connect, publish each item, then disconnect. Items may target different brokers. */
export async function publishAll(items: { broker: string; topic: string; payload: string; retain?: boolean }[]): Promise<void> {
  const groups = new Map<string, { topic: string; payload: string; retain?: boolean }[]>();
  for (const item of items) {
    const list = groups.get(item.broker) ?? [];
    list.push({ topic: item.topic, payload: item.payload, retain: item.retain });
    groups.set(item.broker, list);
  }
  for (const [broker, messages] of groups) {
    await publishGroup(broker, messages);
  }
}

function publishGroup(broker: string, messages: { topic: string; payload: string; retain?: boolean }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn?.close();
      if (error) reject(error);
      else resolve();
    };
    const clientId = `c${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
    let conn: MqttConnection | null = null;
    let acked = false;
    let sent = false;
    const flush = () => {
      if (sent || !acked || !conn) return;
      sent = true;
      for (const message of messages) conn.publish(message.topic, message.payload, message.retain);
      setTimeout(() => done(), 200);
    };
    const timer = setTimeout(() => done(new Error('发送超时')), 8000);
    openMqtt({
      url: broker,
      clientId,
      onConnect() {
        acked = true;
        flush();
      },
      onError(message) {
        done(new Error(message));
      },
    })
      .then((opened) => {
        conn = opened;
        flush();
      })
      .catch((error: unknown) => {
        done(error instanceof Error ? error : new Error('无法连接'));
      });
  });
}
