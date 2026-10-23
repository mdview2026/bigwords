import { h, siteHeader, toast } from '../chrome';
import { go } from '../nav';
import { Display } from '../render/display';
import { parseFragment } from '../state/fragment';
import { resolveSettings } from '../state/params';
import { VIEWER_RETURN_KEY } from '../viewer';
import { APP_VERSION } from '../version';
import { EFFECTS, effectById, effectFragment, effectHex, type Effect } from './effects';
import { phoneLayout } from './phone';
import { openApkDialog } from './apk-dialog';
import { quickMarkup } from './quick-markup';
import { canFullscreen } from '../remote/fullscreen';
import {
  addColorHistory,
  addTextHistory,
  readColorHistory,
  readQuickDraft,
  readTextHistory,
  writeQuickDraft,
  type ColorHistory,
} from './quick-state';

const PALETTE = {
  fg: ['ffffff', 'ffd60a', '111111', 'ff5c5c', '00ff66', '4ea1ff', 'f9d5e5', 'e8f5c8'],
  bg: ['111111', '000000', 'ffffff', 'b00020', '0b3d91', '16382b', 'ffd60a', 'f9d5e5'],
} as const;

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 14 ? `${flat.slice(0, 14)}…` : flat;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The first screen: choose a look, write the words, pick two colors, play.
 * Recent words and colors can be picked again with one tap. The 控制其他屏幕
 * button hands this exact sign to the controller console, so the remote flow
 * never asks for the sign twice.
 */
export function mountQuick(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site page-quick';
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  const saved = readQuickDraft(light);
  let effect: Effect = effectById(saved?.effectId ?? '') ?? EFFECTS[0];
  let text = saved?.text ?? effect.sample;
  let fg = saved?.fg ?? effectHex(effect, 'fg', light);
  let bg = saved?.bg ?? effectHex(effect, 'bg', light);
  let textHistory = readTextHistory();
  let colorHistory: ColorHistory = readColorHistory();

  const page = document.createElement('template');
  page.innerHTML = quickMarkup(APP_VERSION);
  app.replaceChildren(siteHeader('home'), page.content);

  const stage = app.querySelector<HTMLElement>('.quick-stage')!;
  const rail = app.querySelector<HTMLElement>('.quick-effect-rail')!;
  const effectButtons = [...app.querySelectorAll<HTMLButtonElement>('.quick-effect')];
  const currentName = app.querySelector<HTMLElement>('.quick-effect-current')!;
  const field = app.querySelector<HTMLTextAreaElement>('.quick-text')!;
  const historyBox = app.querySelector<HTMLElement>('.quick-history')!;
  const fgInput = app.querySelector<HTMLInputElement>('.quick-color[data-kind="fg"]')!;
  const bgInput = app.querySelector<HTMLInputElement>('.quick-color[data-kind="bg"]')!;
  const fgSwatches = app.querySelector<HTMLElement>('.quick-swatches[data-kind="fg"]')!;
  const bgSwatches = app.querySelector<HTMLElement>('.quick-swatches[data-kind="bg"]')!;
  const play = app.querySelector<HTMLButtonElement>('.quick-play')!;
  const remote = app.querySelector<HTMLButtonElement>('.quick-remote')!;
  const playerLink = app.querySelector<HTMLButtonElement>('.quick-player-link')!;
  const hint = app.querySelector<HTMLElement>('.quick-hint')!;

  field.value = text;
  fgInput.value = `#${fg}`;
  bgInput.value = `#${bg}`;
  hint.textContent = phoneLayout()
    ? canFullscreen()
      ? '点播放全屏，双击切换全屏，返回键退出播放'
      : '点播放全屏，双击退出'
    : '点播放全屏，双击或按 Esc 退出';

  const display = new Display(stage);
  const blank = () => text.trim() === '';

  const render = () => {
    const empty = blank();
    stage.classList.toggle('is-empty', empty);
    play.disabled = empty;
    currentName.textContent = effect.name;
    display.update(
      resolveSettings(parseFragment(effectFragment(effect, empty ? '写点什么' : text, null, { fg, bg }))),
    );
  };

  const remember = () => writeQuickDraft({ effectId: effect.id, text, fg, bg });

  const paintEffects = () => {
    for (const button of effectButtons) button.setAttribute('aria-pressed', button.dataset.effect === effect.id ? 'true' : 'false');
  };

  const paintTextHistory = () => {
    historyBox.replaceChildren();
    if (textHistory.length === 0) {
      historyBox.hidden = true;
      return;
    }
    historyBox.hidden = false;
    historyBox.append(h('span', { class: 'quick-history-label' }, '历史'));
    for (const item of textHistory) {
      const chip = h('button', { class: 'quick-history-chip', type: 'button', title: item }, previewText(item));
      chip.addEventListener('click', () => {
        text = item;
        field.value = item;
        remember();
        render();
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      });
      historyBox.append(chip);
    }
  };

  const paintSwatches = () => {
    const rows: ['fg' | 'bg', HTMLElement, string[]][] = [
      ['fg', fgSwatches, colorHistory.fg],
      ['bg', bgSwatches, colorHistory.bg],
    ];
    for (const [kind, box, recent] of rows) {
      const current = kind === 'fg' ? fg : bg;
      const colors = unique([...recent, ...PALETTE[kind]]).slice(0, 8);
      box.replaceChildren();
      box.append(h('span', { class: 'quick-swatch-note' }, recent.length > 0 ? '最近' : '常用'));
      for (const color of colors) {
        const swatch = h('button', {
          class: 'quick-swatch',
          type: 'button',
          'data-color': color,
          'aria-label': `使用颜色 #${color}`,
          title: `#${color}`,
          'aria-pressed': color === current ? 'true' : 'false',
        });
        swatch.style.backgroundColor = `#${color}`;
        box.append(swatch);
      }
    }
  };

  const setColor = (kind: 'fg' | 'bg', value: string, record: boolean) => {
    const next = value.replace(/^#/, '').trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(next)) return;
    if (kind === 'fg') {
      fg = next;
      fgInput.value = `#${next}`;
    } else {
      bg = next;
      bgInput.value = `#${next}`;
    }
    if (record) colorHistory = addColorHistory(kind, next);
    paintSwatches();
    remember();
    render();
  };

  const selectEffect = (next: Effect) => {
    if (next.id === effect.id) return;
    const previous = effect;
    const wasSample = text === previous.sample;
    const fgWasDefault = fg === effectHex(previous, 'fg', light);
    const bgWasDefault = bg === effectHex(previous, 'bg', light);
    effect = next;
    if (wasSample) {
      text = next.sample;
      field.value = text;
    }
    if (fgWasDefault) fg = effectHex(next, 'fg', light);
    if (bgWasDefault) bg = effectHex(next, 'bg', light);
    fgInput.value = `#${fg}`;
    bgInput.value = `#${bg}`;
    paintEffects();
    paintSwatches();
    remember();
    render();
  };

  const rememberText = () => {
    textHistory = addTextHistory(text);
    paintTextHistory();
  };

  const rememberColors = () => {
    colorHistory = addColorHistory('fg', fg);
    colorHistory = addColorHistory('bg', bg);
    paintSwatches();
  };

  const playNow = () => {
    if (blank()) return;
    rememberText();
    rememberColors();
    remember();
    sessionStorage.setItem(VIEWER_RETURN_KEY, location.href);
    /* go() (pushState) rather than location.assign: staying in this document
       keeps the tap's transient activation, so the viewer enters true
       fullscreen the moment it mounts. */
    go(`/#${effectFragment(effect, text, null, { fg, bg })}`);
  };

  let dialog: HTMLDialogElement | null = null;
  const connectOption = (action: string, title: string, detail: string) =>
    h(
      'button',
      { class: 'quick-connect-option', type: 'button', 'data-connect': action },
      h('strong', {}, title),
      h('span', {}, detail),
    );

  const handoff = (mode: 'scan' | 'show') => {
    go(mode === 'scan' ? '/?role=control' : '/?role=host');
  };

  const onConnect = (action: string) => {
    if (action === 'control-scan' || action === 'control-show') {
      if (blank()) {
        toast('先写点文字');
        return;
      }
      rememberText();
      rememberColors();
      remember();
      handoff(action === 'control-scan' ? 'scan' : 'show');
      return;
    }
    if (action === 'player-scan') go('/?role=player');
    else if (action === 'player-show') go('/?role=join');
  };

  const openConnect = () => {
    rememberText();
    rememberColors();
    remember();
    if (!dialog) {
      dialog = h(
        'dialog',
        { class: 'quick-connect', 'aria-label': '连接屏幕' },
        h('h2', {}, '连接屏幕'),
        h('p', { class: 'quick-connect-lead' }, '牌子已经准备好了。选择这块设备接下来要做的事。'),
        h(
          'section',
          { class: 'quick-connect-group' },
          h('h3', {}, '控制其他屏幕'),
          h('p', { class: 'quick-connect-note', hidden: true }, '先写上文字，才能控制其他屏幕。'),
          h(
            'div',
            { class: 'quick-connect-options' },
            connectOption('control-scan', '我来扫播放端', '用这台设备扫播放端的码'),
            connectOption('control-show', '让播放端扫我', '出示二维码，播放端扫码加入'),
          ),
        ),
        h(
          'section',
          { class: 'quick-connect-group' },
          h('h3', {}, '让这块屏幕播放'),
          h(
            'div',
            { class: 'quick-connect-options' },
            connectOption('player-scan', '等待控制端扫码', '出示本机二维码，等控制端添加'),
            connectOption('player-show', '扫控制端加入', '扫控制端的码，或输入 6 位编号'),
          ),
        ),
        h('button', { class: 'btn quick-connect-close', type: 'button', 'data-close': 'true' }, '取消'),
      ) as HTMLDialogElement;
      dialog.addEventListener('click', (event) => {
        const target = event.target as Element | null;
        if (target?.closest('[data-close]')) {
          dialog?.close();
          return;
        }
        const option = target?.closest<HTMLButtonElement>('[data-connect]');
        if (!option) return;
        const action = option.dataset.connect ?? '';
        dialog?.close();
        onConnect(action);
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog?.close();
      });
      document.body.append(dialog);
    }
    // Being a player never needs words; controlling another screen does.
    for (const option of dialog.querySelectorAll<HTMLButtonElement>('[data-connect^="control"]')) option.disabled = blank();
    const note = dialog.querySelector<HTMLElement>('.quick-connect-note');
    if (note) note.hidden = !blank();
    if (!dialog.open) dialog.showModal();
  };

  const onRailClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.quick-effect');
    if (!button) return;
    const next = effectById(button.dataset.effect ?? '');
    if (next) selectEffect(next);
  };
  const onSwatchClick = (kind: 'fg' | 'bg') => (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-color]');
    if (button?.dataset.color) setColor(kind, button.dataset.color, true);
  };
  const fgSwatchClick = onSwatchClick('fg');
  const bgSwatchClick = onSwatchClick('bg');
  const onHistoryBlur = () => rememberText();
  const onFgInput = () => setColor('fg', fgInput.value, false);
  const onBgInput = () => setColor('bg', bgInput.value, false);
  const onFgChange = () => {
    colorHistory = addColorHistory('fg', fg);
    paintSwatches();
  };
  const onBgChange = () => {
    colorHistory = addColorHistory('bg', bg);
    paintSwatches();
  };

  rail.addEventListener('click', onRailClick);
  fgSwatches.addEventListener('click', fgSwatchClick);
  bgSwatches.addEventListener('click', bgSwatchClick);
  field.addEventListener('input', () => {
    text = field.value;
    remember();
    render();
  });
  field.addEventListener('blur', onHistoryBlur);
  fgInput.addEventListener('input', onFgInput);
  bgInput.addEventListener('input', onBgInput);
  fgInput.addEventListener('change', onFgChange);
  bgInput.addEventListener('change', onBgChange);
  play.addEventListener('click', playNow);
  remote.addEventListener('click', openConnect);
  playerLink.addEventListener('click', openConnect);

  // The header's installer download: show the QR dialog instead of leaving
  // the page (a plain download would also work - the href is the APK).
  const onAppClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    if (!target?.closest?.('a[data-apk]')) return;
    event.preventDefault();
    void openApkDialog();
  };
  app.addEventListener('click', onAppClick);

  paintEffects();
  paintTextHistory();
  paintSwatches();
  render();

  return {
    destroy() {
      rail.removeEventListener('click', onRailClick);
      fgSwatches.removeEventListener('click', fgSwatchClick);
      bgSwatches.removeEventListener('click', bgSwatchClick);
      field.removeEventListener('blur', onHistoryBlur);
      fgInput.removeEventListener('input', onFgInput);
      bgInput.removeEventListener('input', onBgInput);
      fgInput.removeEventListener('change', onFgChange);
      bgInput.removeEventListener('change', onBgChange);
      play.removeEventListener('click', playNow);
      remote.removeEventListener('click', openConnect);
      playerLink.removeEventListener('click', openConnect);
      app.removeEventListener('click', onAppClick);
      if (dialog?.open) dialog.close();
      dialog?.remove();
      dialog = null;
      display.destroy();
    },
  };
}
