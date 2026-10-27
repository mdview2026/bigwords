import { h, toast } from '../chrome';
import { go } from '../nav';
import { sitePath } from '../paths';
import { inAppShell } from './device-id';
import { canFullscreen, fullscreenElement, toggleFullscreen } from './fullscreen';
import { acceptControl, hasAcceptedControl, joinRoom, leaveRoom, watchJoin, watchPending, type JoinState } from './join-link';
import { DEFAULT_BROKER } from './protocol';
import { formatRoomCode, isRoomCode, parseRoomInput } from './room';
import { startScanner } from './scan';

const JOIN_STATUS: Record<JoinState['status'], string> = {
  idle: '',
  connecting: '正在连接',
  online: '已连接，等待播放',
  offline: '连接中断，正在重试',
};

/**
 * The player's page for 播放端扫控制端: scan the code the controller shows
 * (or type its six digits), then go straight to playback. Exiting playback
 * returns to this page; there is no separate 接受控制 gate.
 */
export function mountJoin(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site page-join';
  const back = h('a', { href: sitePath('/') }, '返回');
  back.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go('/');
  });

  // A camera outside the browser opens the URL directly; landing here with the
  // room in the query joins at once, and the parameter is wiped so a reload
  // does not look like a second scan.
  const param = new URLSearchParams(location.search).get('room') ?? '';
  if (isRoomCode(param)) {
    joinRoom(param);
    go('/?role=join');
  }

  // Built once: the camera stream would not survive a repaint.
  const video = h('video', { autoplay: 'true', muted: 'true', playsinline: 'true' }) as HTMLVideoElement;
  video.muted = true;
  const scanner = h('div', { class: 'control-scan', hidden: true }, video);
  const scanBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '扫码加入') as HTMLButtonElement;
  const input = h('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '或输入 6 位编号',
    'aria-label': '控制端编号',
  }) as HTMLInputElement;
  const addBtn = h('button', { class: 'btn', type: 'button' }, '加入') as HTMLButtonElement;
  let stopScan: (() => void) | null = null;
  // Logical state, apart from the camera handle: a code can decode on the very
  // first frame, before startScanner's promise hands back the stop function.
  let scanning = false;

  const done = () => {
    scanning = false;
    input.value = '';
    stopScan?.();
    stopScan = null;
    scanner.hidden = true;
    scanBtn.textContent = '扫码加入';
  };
  const addText = (text: string): boolean => {
    const parsed = parseRoomInput(text);
    if (!parsed.ok) {
      toast(parsed.reason === 'player-code' ? '这是播放器的编号。要扫控制端出示的二维码，或输入控制端的 6 位编号' : '这不是有效的房间编号');
      return false;
    }
    joinRoom(parsed.room, parsed.broker === DEFAULT_BROKER ? undefined : parsed.broker);
    done();
    return true;
  };
  scanBtn.addEventListener('click', () => {
    if (scanning) {
      done();
      return;
    }
    scanning = true;
    void startScanner(video, addText)
      .then((stop) => {
        // A first-frame decode already closed the scanner: release the camera.
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
  addBtn.addEventListener('click', () => addText(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addText(input.value);
    }
  });

  const room = h('p', { class: 'player-number' });
  const status = h('p', { class: 'player-status' });
  const number = h('p', { class: 'player-number', hidden: true });
  const waiting = h('p', { class: 'host-hint', hidden: true }, '还没收到编号：控制端可能没打开，或房间已满');
  const playHint = h('p', { class: 'player-wall', hidden: true }, '控制端已开始播放');
  // One button does both jobs: enter playback, and where the browser allows
  // it, hide its own bars too. iPhone Safari has no Fullscreen API and the
  // app's WebView is already full-bleed, so there the tap only enters playback.
  const fullscreen = canFullscreen() && !inAppShell();
  const play = h('button', { class: 'btn btn-primary', type: 'button' }, fullscreen ? '全屏播放' : '继续播放') as HTMLButtonElement;
  play.addEventListener('click', () => {
    acceptControl();
    if (fullscreen && !fullscreenElement()) toggleFullscreen();
  });
  const exitBtn = h('button', { class: 'btn', type: 'button' }, '退出房间') as HTMLButtonElement;
  exitBtn.addEventListener('click', () => {
    leaveRoom();
    toast('已退出房间');
  });

  const enter = h(
    'div',
    { class: 'join-enter' },
    h('p', { class: 'player-lead' }, '扫控制端出示的二维码，或输入控制端的 6 位编号。加入后会直接进入播放。'),
    scanBtn,
    scanner,
    h('div', { class: 'control-add' }, input, addBtn),
  );
  const joined = h(
    'div',
    { class: 'join-in', hidden: true },
    h('p', { class: 'player-status' }, '已加入'),
    room,
    status,
    number,
    waiting,
    playHint,
    h('p', { class: 'player-auto-hint' }, '已自动进入播放。退出播放后可回到这里继续。'),
    h('div', { class: 'join-actions' }, play, exitBtn),
  );

  let waitTimer = 0;
  const armWait = () => {
    if (waitTimer) return;
    waitTimer = window.setTimeout(() => {
      waitTimer = 0;
      waiting.hidden = false;
    }, 6000);
  };
  const clearWait = () => {
    clearTimeout(waitTimer);
    waitTimer = 0;
    waiting.hidden = true;
  };

  let pendingPlaying = false;
  let autoTimer = 0;
  // The first numbered moment (or the first command, if the room is already
  // playing) takes over the screen without another tap. Once the tab has
  // accepted, an exit stays an exit.
  const scheduleAutoAccept = () => {
    if (hasAcceptedControl() || autoTimer) return;
    autoTimer = window.setTimeout(() => {
      autoTimer = 0;
      if (!hasAcceptedControl() && (pendingPlaying || !number.hidden)) acceptControl();
    }, 0);
  };
  const paint = (state: JoinState) => {
    const inRoom = state.room;
    enter.hidden = inRoom !== null;
    joined.hidden = inRoom === null;
    if (!inRoom) {
      clearWait();
      clearTimeout(autoTimer);
      autoTimer = 0;
      number.hidden = true;
      return;
    }
    room.textContent = `控制端编号 ${formatRoomCode(inRoom)}`;
    status.textContent = JOIN_STATUS[state.status];
    number.hidden = state.info === null;
    number.textContent = state.info ? `第 ${state.info.slot} 台 / 共 ${state.info.total} 台` : '';
    if (state.info === null) armWait();
    else {
      clearWait();
      scheduleAutoAccept();
    }
  };
  const unwatch = watchJoin(paint);
  const unwatchPending = watchPending((playing) => {
    pendingPlaying = playing;
    playHint.hidden = !playing;
    if (playing) scheduleAutoAccept();
  });

  app.replaceChildren(
    h('header', { class: 'studio-bar' }, back, h('strong', {}, '播放器')),
    h('main', { class: 'join-screen' }, enter, joined),
  );

  return {
    destroy() {
      done();
      unwatch();
      unwatchPending();
      clearWait();
      clearTimeout(autoTimer);
    },
  };
}
