import { h } from '../chrome';
import { go } from '../nav';
import { sitePath } from '../paths';
import { createQrSvg } from '../render/qr';
import { deviceId, inAppShell } from './device-id';
import { canFullscreen, fullscreenElement, toggleFullscreen } from './fullscreen';
import { publishAll } from './mqtt';
import {
  acceptControl,
  hasAcceptedControl,
  playerInfo,
  playerStatus,
  playerWall,
  wasAdded,
  watchPending,
  watchPlayerInfo,
  watchPlayerStatus,
  watchPlayerWall,
  type PlayerStatus,
} from './player-link';
import { DEFAULT_BROKER, formatPlayerId, pairingText, playerInfoTopic } from './protocol';

const STATUS: Record<PlayerStatus, string> = {
  connecting: '正在连接',
  online: '已连接，等待控制',
  offline: '连接中断，正在重试',
};

/** Marks this tab as already showing the player, so a refresh is a refresh and not a fresh visit. */
const SEEN_KEY = 'bw-player-seen';

/**
 * The player's page for 控制端扫播放端: show the QR code until a controller
 * adds this screen, then go straight to playback. Exiting playback returns
 * to this status page; there is no separate 接受控制 gate.
 */
export function mountPlayer(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site page-player';
  const id = deviceId();
  const back = h('a', { href: sitePath('/') }, '返回');
  back.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go('/');
  });
  // One status line per state: an element lives in one parent only, so the
  // waiting page and the joined page each carry their own copy of it.
  const waitStatus = h('p', { class: 'player-status' }, STATUS[playerStatus()]);
  const joinStatus = h('p', { class: 'player-status' }, STATUS[playerStatus()]);

  const qr = createQrSvg(pairingText(id));
  const code = h('div', { class: 'player-qr' }, qr ?? h('p', {}, '二维码生成失败'));
  const waiting = h(
    'div',
    { class: 'player-wait' },
    h('p', { class: 'player-lead' }, '在控制端点“扫码”扫这个码，或把下面的编号告诉控制端。编号相当于口令，拿到它的人可以控制这块屏幕。'),
    code,
    h('p', { class: 'player-id' }, formatPlayerId(id)),
    waitStatus,
  );

  const number = h('p', { class: 'player-number' });
  const wallNote = h('p', { class: 'player-wall', hidden: true });
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
  const joined = h(
    'div',
    { class: 'player-joined', hidden: true },
    h('p', { class: 'player-status' }, '已加入'),
    number,
    wallNote,
    playHint,
    joinStatus,
    h('p', { class: 'player-auto-hint' }, '已自动进入播放。退出播放后可回到这里继续。'),
    h('div', { class: 'player-actions' }, play),
  );

  app.replaceChildren(
    h('header', { class: 'studio-bar' }, back, h('strong', {}, '播放器')),
    h('main', { class: 'player-screen' }, waiting, joined),
  );

  const unwatch = watchPlayerStatus((next) => {
    waitStatus.textContent = STATUS[next];
    joinStatus.textContent = STATUS[next];
  });
  // A fresh visit (first open in this tab, not a refresh) starts unpaired:
  // whatever number an earlier session left on the broker is last run's
  // business, so it is cleared there too. While the clear is in flight the
  // link may still hand us the stale number — those paints are held until the
  // number is really gone.
  let settling = false;
  try {
    if (sessionStorage.getItem(SEEN_KEY) !== '1') {
      sessionStorage.setItem(SEEN_KEY, '1');
      if (wasAdded()) {
        settling = true;
        void publishAll([{ broker: DEFAULT_BROKER, topic: playerInfoTopic(id), payload: '', retain: true }])
          .catch(() => {
            // Offline: the stale number stays on the broker, but this run
            // still opens on the QR; a scan will number it again anyway.
          })
          .finally(() => {
            if (playerInfo() === null) {
              settling = false;
              return;
            }
            // The clear's empty echo is still on its way to this tab's
            // subscription; keep holding. A timeout ends the hold in case
            // it never lands.
            window.setTimeout(() => {
              settling = false;
              paintNumber(playerInfo());
            }, 1500);
          });
      }
    }
  } catch {
    // Storage can be blocked: treat the open as a refresh and keep the state.
  }
  let pendingPlaying = false;
  let autoTimer = 0;
  // The first time this tab is numbered, or the controller is already playing,
  // take over the screen without another tap. Once the tab has accepted, an
  // exit stays an exit (it can still be driven by the next command).
  const scheduleAutoAccept = () => {
    if (hasAcceptedControl() || autoTimer) return;
    autoTimer = window.setTimeout(() => {
      autoTimer = 0;
      if (!hasAcceptedControl() && (playerInfo() !== null || pendingPlaying)) acceptControl();
    }, 0);
  };
  // Being added fills in the number and takes the screen to playback; being
  // removed (the number is a retained topic) brings the QR back. A number that
  // is on its way out does not count as being added.
  const paintNumber = (next: ReturnType<typeof playerInfo>) => {
    if (settling && next !== null) return;
    const added = next !== null;
    waiting.hidden = added;
    joined.hidden = !added;
    if (next) {
      number.textContent = `第 ${next.slot} 台 / 共 ${next.total} 台`;
      scheduleAutoAccept();
    } else {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
  };
  const unwatchInfo = watchPlayerInfo(paintNumber);
  // After a refresh (or a double-tap back from playback) the link's knowledge
  // is "none yet" until the retained number arrives. A screen numbered on an
  // earlier visit knows better: open straight on the joined offer instead of
  // flashing the QR first.
  if (!settling && wasAdded() && playerInfo() === null) {
    waiting.hidden = true;
    joined.hidden = false;
  }
  const paintWall = (next: ReturnType<typeof playerWall>) => {
    wallNote.hidden = next === null;
    wallNote.textContent = next ? `拼接屏第 ${next.slot} 段，共 ${next.total} 段` : '';
  };
  const unwatchWall = watchPlayerWall(paintWall);
  const unwatchPending = watchPending((playing) => {
    pendingPlaying = playing;
    playHint.hidden = !playing;
    if (playing) scheduleAutoAccept();
  });
  return {
    destroy() {
      unwatch();
      unwatchInfo();
      unwatchWall();
      unwatchPending();
      clearTimeout(autoTimer);
    },
  };
}
