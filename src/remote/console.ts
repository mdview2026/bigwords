import { h, toast } from '../chrome';
import { go } from '../nav';
import { sitePath } from '../paths';
import { Display } from '../render/display';
import { createQrSvg } from '../render/qr';
import { parseFragment } from '../state/fragment';
import { resolveSettings } from '../state/params';
import { EFFECTS, effectById, effectFragment, effectHex } from '../simple/effects';
import { readQuickDraft } from '../simple/quick-state';
import { publishAll } from './mqtt';
import {
  DEFAULT_BROKER,
  blackFragment,
  encodeCommand,
  encodeInfo,
  formatPlayerId,
  MAX_SLOTS,
  parsePairing,
  playerInfoTopic,
  playerTopic,
  wallFragment,
} from './protocol';
import { movePlayer, readRoster, removePlayer, upsertPlayer, type PairedPlayer } from './roster';
import { startScanner } from './scan';
import { broadcastLive, endSession, startHost, stopHost, watchHost, type HostState } from './room-host';
import { formatRoomCode, makeRoomCode, readHostRoom, roomQrText, writeHostRoom } from './room';

/** The most screens the controller's preview draws. The real wall may be longer. */
const PREVIEW_SCREENS = 5;

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 22 ? `${flat.slice(0, 22)}…` : flat;
}

/**
 * The controller after the composer: one console that connects screens and
 * plays, with no step wizard. The sign comes from the home page's quick draft;
 * 修改内容 goes back there, and the roster or room survives the trip.
 * `mode` is the joining direction: 'scan' means this phone scans the players'
 * codes, 'show' means the players scan this phone's room code.
 */
export function mountConsole(app: HTMLElement, mode: 'scan' | 'show'): { destroy(): void } {
  document.body.className = 'page-site page-console';
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  const saved = readQuickDraft(light);
  const effect = effectById(saved?.effectId ?? '') ?? EFFECTS[0];
  const text = saved && saved.text.trim() !== '' ? saved.text : effect.sample;
  const fg = saved?.fg ?? effectHex(effect, 'fg', light);
  const bg = saved?.bg ?? effectHex(effect, 'bg', light);
  const fragment = effectFragment(effect, text, null, { fg, bg });

  const removeLinks: (() => void)[] = [];
  const linkHome = (label: string, cls: string) => {
    const link = h('a', { class: cls, href: sitePath('/') }, label);
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go('/');
    };
    link.addEventListener('click', onClick);
    removeLinks.push(() => link.removeEventListener('click', onClick));
    return link;
  };

  const frames = h('div', { class: 'console-frames' });
  const signLabel = h('span', { class: 'console-sign' }, `${effect.name} · ${previewText(text)}`);
  const preview = h(
    'section',
    { class: 'console-preview', 'aria-label': '播放预览' },
    frames,
    h('div', { class: 'console-preview-foot' }, signLabel, linkHome('修改内容', 'btn btn-sm')),
  );

  const list = h('div', { class: 'control-list' });
  const playBtn = h('button', { class: 'btn btn-primary console-play-btn', type: 'button' }, '播放') as HTMLButtonElement;
  const stopBtn = h('button', { class: 'btn console-stop-btn', type: 'button', hidden: true }, '停止播放') as HTMLButtonElement;
  const playHint = h('p', { class: 'console-hint' }, '先连接一块播放屏幕。');
  const playStatus = h('span', { class: 'console-status' });
  const playCard = h(
    'section',
    { class: 'console-card console-play', 'aria-label': '播放控制' },
    h('div', { class: 'console-card-head' }, h('h2', {}, '播放'), playStatus),
    h('div', { class: 'console-play-actions' }, playBtn, stopBtn),
    playHint,
  );

  const latest = { state: null as HostState | null };
  let playing = false;
  let busy = false;
  let stopScan: (() => void) | null = null;
  let unwatchHost: (() => void) | null = null;
  let hosting = false;

  /** The screens that will play: the scanned roster, or the room's members. */
  const players = (): { id: string; broker: string; slot: number }[] =>
    mode === 'scan'
      ? readRoster()
      : (latest.state?.members ?? []).map((member) => ({ id: member.id, broker: DEFAULT_BROKER, slot: member.slot }));

  let previewTotal = -1;
  let previewDisplays: Display[] = [];
  const paintPreview = (total: number) => {
    if (total === previewTotal) return;
    previewTotal = total;
    for (const display of previewDisplays) display.destroy();
    previewDisplays = [];
    frames.replaceChildren();
    const shown = total <= 1 ? 1 : Math.min(total, PREVIEW_SCREENS);
    frames.classList.toggle('is-multi', shown > 1);
    frames.classList.toggle('is-empty', total === 0);
    for (let slot = 1; slot <= shown; slot++) {
      const stage = h('div', { class: 'console-frame-stage' });
      const display = new Display(stage);
      display.update(resolveSettings(parseFragment(total <= 1 ? fragment : wallFragment(fragment, slot, total))));
      previewDisplays.push(display);
      frames.append(
        h(
          'div',
          { class: 'console-frame' },
          shown > 1 ? h('span', { class: 'control-slot' }, String(slot)) : null,
          stage,
        ),
      );
    }
  };

  const setPlaying = (on: boolean) => {
    playing = on;
    playBtn.hidden = on;
    stopBtn.hidden = !on;
    playStatus.textContent = on ? '播放中' : '';
    playStatus.classList.toggle('is-playing', on);
  };

  const updatePlay = (total: number) => {
    playBtn.textContent = total > 1 ? `播放到 ${total} 块屏幕` : '播放';
    playBtn.disabled = total === 0 || busy;
    stopBtn.disabled = busy;
    playHint.textContent =
      total === 0
        ? '先连接一块播放屏幕。'
        : total === 1
          ? '只有一台时，这块屏单独显示。'
          : `${total} 台会拼成一块大牌子，按编号从左到右摆放。`;
    if (total === 0 && playing) setPlaying(false);
  };

  const send = (sign: string): Promise<void> => {
    const screens = players();
    if (screens.length === 0) return Promise.reject(new Error('no screens'));
    if (mode === 'show' && screens.length === 1) return broadcastLive(sign);
    const items = screens.map((player, index) => ({
      broker: player.broker,
      topic: playerTopic(player.id),
      payload: encodeCommand(wallFragment(sign, index + 1, screens.length)),
    }));
    return publishAll(items);
  };

  // Stop is safe to broadcast even on a wall: black carries no slice, and
  // clearing the room's retained play means a late joiner will not walk into
  // the old show.
  const sendStop = (): Promise<void> => (mode === 'show' ? broadcastLive(blackFragment()) : send(blackFragment()));

  const sendNumbers = (roster: PairedPlayer[], clear: { broker: string; id: string }[] = []) => {
    const items = [
      ...roster.map((player) => ({
        broker: player.broker,
        topic: playerInfoTopic(player.id),
        payload: encodeInfo({ slot: player.slot, total: roster.length }),
        retain: true,
      })),
      ...clear.map((gone) => ({ broker: gone.broker, topic: playerInfoTopic(gone.id), payload: '', retain: true })),
    ];
    if (items.length === 0) return;
    void publishAll(items).catch(() => toast('编号没发出去，联网后可重试'));
  };

  // One screen row of the devices list: its number, its id, and how to fix the order.
  const row = (
    player: { slot: number; id: string },
    onMove: (delta: number) => void,
    onRemove: () => void,
    first: boolean,
    last: boolean,
  ) => {
    const up = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': '上移' }, '↑') as HTMLButtonElement;
    up.disabled = first;
    up.addEventListener('click', () => onMove(-1));
    const down = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': '下移' }, '↓') as HTMLButtonElement;
    down.disabled = last;
    down.addEventListener('click', () => onMove(1));
    const del = h('button', { class: 'btn btn-sm', type: 'button' }, '移除') as HTMLButtonElement;
    del.addEventListener('click', onRemove);
    return h(
      'div',
      { class: 'control-row' },
      h('label', {}, h('span', { class: 'control-slot' }, String(player.slot)), h('span', {}, formatPlayerId(player.id))),
      h('div', { class: 'control-move' }, up, down, del),
    );
  };

  /** Build the connection half for this direction. It owns the camera/scanner. */
  const buildConnection = (): { card: HTMLElement } => {
    if (mode === 'scan') {
      const scanBtn = h('button', { class: 'btn btn-primary console-scan-btn', type: 'button' }, '扫码添加') as HTMLButtonElement;
      const manual = h('input', {
        type: 'text',
        inputmode: 'text',
        placeholder: '或输入播放端编号',
        'aria-label': '播放端编号',
      }) as HTMLInputElement;
      const addBtn = h('button', { class: 'btn console-add-btn', type: 'button' }, '添加') as HTMLButtonElement;
      const video = h('video', { autoplay: 'true', muted: 'true', playsinline: 'true' }) as HTMLVideoElement;
      video.muted = true;
      const scanner = h('div', { class: 'control-scan', hidden: true }, video);
      const status = h('span', { class: 'console-status' }, '扫码或输入编号');

      const paintRoster = (roster: PairedPlayer[]) => {
        list.replaceChildren(
          ...(roster.length === 0
            ? [h('p', { class: 'console-empty' }, '还没有播放设备。扫播放端二维码，或输入编号添加。')]
            : roster.map((player, index) =>
                row(
                  player,
                  (delta) => apply(movePlayer(player.id, delta)),
                  () => {
                    const gone = readRoster().find((item) => item.id === player.id);
                    const next = removePlayer(player.id);
                    apply(next, gone ? [{ broker: gone.broker, id: gone.id }] : []);
                  },
                  index === 0,
                  index === roster.length - 1,
                ),
              )),
        );
        status.textContent = roster.length > 0 ? `${roster.length} 块屏已连接` : '扫码或输入编号';
        paintPreview(roster.length);
        updatePlay(roster.length);
      };
      const apply = (roster: PairedPlayer[], clear: { broker: string; id: string }[] = []) => {
        paintRoster(roster);
        sendNumbers(roster, clear);
      };

      // The scanner's logical state, apart from the camera handle: a code can
      // decode on the very first frame, before startScanner's promise hands
      // back the stop function, so stopScan alone cannot say "scanning".
      let scanning = false;
      const closeScanner = () => {
        scanning = false;
        stopScan?.();
        stopScan = null;
        scanner.hidden = true;
        scanBtn.textContent = '扫码添加';
      };

      const addText = (value: string): boolean => {
        const pairing = parsePairing(value);
        if (!pairing) {
          toast('这不是播放端二维码');
          return false;
        }
        const roster = readRoster();
        const known = roster.some((player) => player.id === pairing.id);
        if (!known && roster.length >= MAX_SLOTS) {
          toast(`最多 ${MAX_SLOTS} 台`);
          return false;
        }
        apply(upsertPlayer(pairing));
        manual.value = '';
        toast(known ? '这台已经在列表里' : '已添加播放设备');
        closeScanner();
        return true;
      };

      scanBtn.addEventListener('click', () => {
        if (scanning) {
          closeScanner();
          return;
        }
        scanning = true;
        void startScanner(video, addText)
          .then((stop) => {
            // A first-frame decode already closed the scanner: the camera
            // came up after addText ran, so just release it.
            if (!scanning) {
              stop();
              return;
            }
            stopScan = stop;
            scanner.hidden = false;
            scanBtn.textContent = '停止扫描';
          })
          .catch(() => {
            scanning = false;
            toast('无法打开相机，可以手动输入编号');
          });
      });
      addBtn.addEventListener('click', () => addText(manual.value));
      manual.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addText(manual.value);
        }
      });

      paintRoster(readRoster());
      return {
        card: h(
          'section',
          { class: 'console-card', 'aria-label': '连接播放屏幕' },
          h('div', { class: 'console-card-head' }, h('h2', {}, '连接播放屏幕'), status),
          h('div', { class: 'console-add-row' }, scanBtn, manual, addBtn),
          scanner,
          list,
        ),
      };
    }

    // The show direction: this phone's room code is the thing the players scan.
    let room = readHostRoom();
    if (!room) {
      room = makeRoomCode();
      writeHostRoom(room);
    }
    const code = h('p', { class: 'host-code' }, formatRoomCode(room));
    const qr = h('div', { class: 'player-qr' });
    const paintQr = (value: string) => {
      const text = location.protocol === 'file:' ? roomQrText(value) : new URL(sitePath(`/?role=join&room=${value}`), location.href).href;
      qr.replaceChildren(createQrSvg(text) ?? h('p', {}, '二维码生成失败'));
    };
    paintQr(room);
    const status = h('p', { class: 'player-status' });
    const rebind = h('button', { class: 'btn btn-sm', type: 'button' }, '换一个编号') as HTMLButtonElement;
    rebind.addEventListener('click', () => {
      const old = room!;
      void endSession()
        .catch(() => undefined)
        .then(() => {
          let next = makeRoomCode();
          while (next === old) next = makeRoomCode();
          writeHostRoom(next);
          room = next;
          code.textContent = formatRoomCode(next);
          paintQr(next);
          startHost(next);
          toast('已换新编号，旧编号里的屏幕已退出');
        });
    });

    const paint = (state: HostState) => {
      latest.state = state;
      status.textContent =
        state.status === 'online' ? '等待播放端扫码或输入编号加入' : state.status === 'connecting' ? '正在连接' : '连接中断，正在重试';
      list.replaceChildren(
        ...(state.members.length === 0
          ? [h('p', { class: 'console-empty' }, '还没有播放设备加入。播放端扫码或输入上面的编号，就会出现在这里。')]
          : state.members.map((member) =>
              h(
                'div',
                { class: 'control-row' },
                h('label', {}, h('span', { class: 'control-slot' }, String(member.slot)), h('span', {}, formatPlayerId(member.id))),
              ),
            )),
      );
      paintPreview(state.members.length);
      updatePlay(state.members.length);
    };

    unwatchHost = watchHost(paint);
    hosting = true;
    startHost(room);

    return {
      card: h(
        'section',
        { class: 'console-card', 'aria-label': '播放端加入' },
        h('div', { class: 'console-card-head' }, h('h2', {}, '播放端加入'), h('span', { class: 'console-status' }, '扫码或输入编号')),
        code,
        qr,
        status,
        list,
        h('div', { class: 'host-tools' }, rebind),
      ),
    };
  };

  const connection = buildConnection();
  const main = h('main', { class: 'console' }, preview, h('div', { class: 'console-panel' }, connection.card, playCard));
  app.replaceChildren(h('header', { class: 'studio-bar' }, linkHome('返回', 'console-back'), h('strong', {}, '控制端')), main);

  playBtn.addEventListener('click', () => {
    const screens = players();
    if (screens.length === 0 || busy) return;
    busy = true;
    updatePlay(screens.length);
    void send(fragment)
      .then(() => setPlaying(true))
      .catch(() => toast('播放没发出去，请检查网络'))
      .finally(() => {
        busy = false;
        updatePlay(players().length);
      });
  });
  stopBtn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    updatePlay(players().length);
    void sendStop()
      .then(() => setPlaying(false))
      .catch(() => toast('停止没发出去，请检查网络'))
      .finally(() => {
        busy = false;
        updatePlay(players().length);
      });
  });

  if (mode === 'scan') paintPreview(players().length);
  updatePlay(players().length);

  return {
    destroy() {
      stopScan?.();
      stopScan = null;
      unwatchHost?.();
      unwatchHost = null;
      if (hosting) stopHost();
      for (const display of previewDisplays) display.destroy();
      previewDisplays = [];
      for (const remove of removeLinks) remove();
    },
  };
}
