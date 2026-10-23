import { h, toast } from '../chrome';
import { go } from '../nav';
import { sitePath } from '../paths';
import { Display } from '../render/display';
import { parseFragment } from '../state/fragment';
import { resolveSettings } from '../state/params';
import { VIEWER_RETURN_KEY } from '../viewer';
import { readOrient } from '../orient';
import { readDraft, writeDraft } from './draft';
import { orientToggle } from './orient-control';
import { phoneLayout } from './phone';
import { effectById, effectFragment, effectHex, type Effect } from './effects';
import { openSendDialog } from '../remote/send-dialog';
import { canFullscreen } from '../remote/fullscreen';

const SIZE_MIN = 4;
const SIZE_MAX = 70;
const PLAY_TIP_KEY = 'bw-play-tip';

function skipPlayTip(): boolean {
  try {
    return localStorage.getItem(PLAY_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSkipPlayTip(): void {
  try {
    localStorage.setItem(PLAY_TIP_KEY, '1');
  } catch {
    // Storage can be blocked. The tip shows again next time.
  }
}

function fittedVh(stage: HTMLElement): number {
  const block = stage.querySelector<HTMLElement>('.bw-block');
  const px = block ? parseFloat(getComputedStyle(block).fontSize) : NaN;
  const height = stage.clientHeight || 1;
  if (!Number.isFinite(px) || px <= 0) return 18;
  return (px / height) * 100;
}

function clampSize(vh: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, vh));
}

function viewerHref(fragment: string): string {
  return sitePath(`/#${fragment}`);
}

export function mountStudio(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site page-studio';
  const id = new URLSearchParams(location.search).get('e') ?? '';
  const effect = effectById(id);
  if (!effect) {
    app.replaceChildren(missing());
    return { destroy() {} };
  }
  return mountEditor(app, effect);
}

function missing(): HTMLElement {
  return h(
    'main',
    { class: 'studio-missing' },
    h('h1', {}, '没有这个效果'),
    h('p', {}, '回到列表里再选一个。'),
    h('a', { class: 'btn btn-primary', href: sitePath('/') }, '选一个效果'),
  );
}

function mountEditor(app: HTMLElement, effect: Effect): { destroy(): void } {
  const saved = readDraft(effect.id);
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  const initialFg = effectHex(effect, 'fg', light);
  const initialBg = effectHex(effect, 'bg', light);
  let text = saved?.text ?? effect.sample;
  let size: number | null = saved?.size ?? null;
  let pace: number | null = saved?.pace ?? null;
  let fg = saved?.fg ?? initialFg;
  let bg = saved?.bg ?? initialBg;
  let pointerY = 0;

  const screen = h('div', {
    class: 'studio-screen',
    tabindex: '0',
    'aria-label': '预览',
  });
  const phone = phoneLayout();
  if (!phone) {
    screen.setAttribute('aria-label', '预览。在画面上滚动滚轮，或按上下方向键，调整大小');
  }
  const hint = h('p', { class: 'studio-hint' });
  const field = h('textarea', {
    id: 'studio-text',
    rows: '2',
    enterkeyhint: 'done',
    'aria-label': '要展示的文字',
    placeholder: '写上要展示的文字，回车可以换行',
  }) as HTMLTextAreaElement;
  field.value = text;
  const fgControl = colorControl('选择文字颜色', fg);
  const bgControl = colorControl('选择背景颜色', bg);
  const finish = h('button', { class: 'btn btn-primary', type: 'button' }, phone ? '播放' : '定稿') as HTMLButtonElement;
  const send = h('button', { class: 'btn', type: 'button' }, '发送') as HTMLButtonElement;
  const dialog = phone ? null : (h('dialog', { class: 'done-dialog' }) as HTMLDialogElement);

  const display = new Display(screen);

  const back = h('a', { href: sitePath('/') }, '换一个效果');
  back.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go('/');
  });

  const form = h(
    'form',
    { class: 'studio-compose' },
    h('label', { class: 'studio-text-label', for: 'studio-text' }, '要展示的文字'),
    field,
    h('div', { class: 'studio-tools' }, h('div', { class: 'studio-colors' }, fgControl.button, bgControl.button), orientToggle(() => applyPreviewFrame())),
  );
  const onSubmit = (event: Event) => event.preventDefault();
  form.addEventListener('submit', onSubmit);

  let pendingPlay = '';
  const playNow = (href: string) => {
    sessionStorage.setItem(VIEWER_RETURN_KEY, location.href);
    // go() (pushState) keeps this document - and the tap's transient
    // activation - so playback opens straight into true fullscreen.
    go(href);
  };
  const tip = phone
    ? playTip((skip) => {
        if (skip) rememberSkipPlayTip();
        const href = pendingPlay;
        pendingPlay = '';
        if (href) playNow(href);
      })
    : null;

  app.replaceChildren(
    h('header', { class: 'studio-bar' }, back, h('div', { class: 'studio-actions' }, send, finish)),
    h('div', { class: 'studio' }, h('div', { class: 'studio-stage' }, screen), form),
    hint,
    ...(dialog ? [dialog] : []),
    ...(tip ? [tip] : []),
  );

  const linkOptions = () => ({
    fg: fg === initialFg ? null : fg,
    bg: bg === initialBg ? null : bg,
    pace,
  });

  const applyPreviewFrame = () => {
    const portraitPage = window.innerHeight > window.innerWidth + 40;
    const simulate = phone && portraitPage && readOrient() === 'landscape';
    screen.classList.toggle('is-land', simulate);
    if (simulate) {
      const ratio = window.innerHeight / Math.max(window.innerWidth, 1);
      screen.style.setProperty('--preview-ratio', String(Math.round(ratio * 1000) / 1000));
    } else {
      screen.style.removeProperty('--preview-ratio');
    }
  };

  const syncChrome = () => {
    const blank = text.trim() === '';
    finish.disabled = blank;
    send.disabled = blank;
    screen.classList.toggle('is-empty', blank);
    hint.textContent = phone
      ? canFullscreen()
        ? '播放时，左侧上下滑动调节速度，右侧上下滑动调节大小。双击切换全屏，返回键退出播放'
        : '播放时，左侧上下滑动调节速度，右侧上下滑动调节大小。双击退出'
      : '滚轮可调预览大小。全屏后左侧上下滑动调节速度，右侧上下滑动调节大小。双击或按 Esc 退出';
  };

  const render = () => {
    syncChrome();
    const shown = text.trim() === '' ? '写点什么' : text;
    display.update(resolveSettings(parseFragment(effectFragment(effect, shown, size, linkOptions()))));
  };

  const remember = () => writeDraft(effect.id, { text, size, fg, bg, pace });

  const nudge = (current: number, factor: number) => {
    size = clampSize(current * factor);
    remember();
    syncChrome();
    display.setSize({ value: size, unit: 'vh' });
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= screen.clientHeight || 1;
    const base = size ?? fittedVh(screen);
    nudge(base, Math.exp(-delta * 0.0016));
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const base = size ?? fittedVh(screen);
    nudge(base, event.key === 'ArrowUp' ? 1.08 : 1 / 1.08);
  };

  let pinch: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length >= 2) {
      pinch = touchDistance(event.touches);
      return;
    }
    pinch = null;
    pointerY = event.touches[0]?.clientY ?? pointerY;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length >= 2) {
      const dist = touchDistance(event.touches);
      if (pinch == null || dist === 0) {
        pinch = dist;
        return;
      }
      event.preventDefault();
      const factor = dist / pinch;
      pinch = dist;
      if (Math.abs(factor - 1) < 0.01) return;
      nudge(size ?? fittedVh(screen), factor);
      return;
    }
    const y = event.touches[0]?.clientY;
    if (y == null) return;
    event.preventDefault();
    const dy = pointerY - y;
    pointerY = y;
    if (dy === 0) return;
    nudge(size ?? fittedVh(screen), Math.exp(dy * 0.01));
  };

  const onInput = () => {
    text = field.value;
    remember();
    render();
  };

  const onColor = (kind: 'fg' | 'bg') => {
    const input = kind === 'fg' ? fgControl.input : bgControl.input;
    const next = input.value.replace(/^#/, '').toLowerCase();
    if (kind === 'fg') fg = next;
    else bg = next;
    remember();
    display.setColors(bg, fg);
  };

  let closeSend = () => {};
  const onSend = () => {
    if (text.trim() === '') return;
    closeSend();
    closeSend = openSendDialog(effectFragment(effect, text, size, linkOptions()));
  };

  const onFinish = () => {
    if (text.trim() === '') return;
    const href = viewerHref(effectFragment(effect, text, size, linkOptions()));
    if (phone) {
      if (skipPlayTip() || !tip) {
        playNow(href);
        return;
      }
      pendingPlay = href;
      if (!tip.open) tip.showModal();
      return;
    }
    const absolute = new URL(href, location.href).href;
    void copyLink(absolute).then((copied) => openDone(dialog!, href, copied));
  };

  screen.addEventListener('wheel', onWheel, { passive: false });
  screen.addEventListener('keydown', onKey);
  screen.addEventListener('touchstart', onTouchStart, { passive: true });
  screen.addEventListener('touchmove', onTouchMove, { passive: false });
  field.addEventListener('input', onInput);
  finish.addEventListener('click', onFinish);
  send.addEventListener('click', onSend);
  const onFg = () => onColor('fg');
  const onBg = () => onColor('bg');
  fgControl.input.addEventListener('input', onFg);
  bgControl.input.addEventListener('input', onBg);

  const unbindKeyboard = bindKeyboard(field);
  applyPreviewFrame();
  const onResize = () => applyPreviewFrame();
  window.addEventListener('resize', onResize);
  render();
  remember();
  if (!saved && !phone) {
    field.focus();
    field.setSelectionRange(0, field.value.length);
  }

  return {
    destroy() {
      unbindKeyboard();
      screen.removeEventListener('wheel', onWheel);
      screen.removeEventListener('keydown', onKey);
      screen.removeEventListener('touchstart', onTouchStart);
      screen.removeEventListener('touchmove', onTouchMove);
      field.removeEventListener('input', onInput);
      finish.removeEventListener('click', onFinish);
      send.removeEventListener('click', onSend);
      closeSend();
      fgControl.input.removeEventListener('input', onFg);
      bgControl.input.removeEventListener('input', onBg);
      fgControl.dialog.remove();
      bgControl.dialog.remove();
      form.removeEventListener('submit', onSubmit);
      window.removeEventListener('resize', onResize);
      dialog?.close();
      tip?.close();
      display.destroy();
    },
  };
}

function touchDistance(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Keep the editor inside the visible area while the phone keyboard is open. */
function bindKeyboard(field: HTMLTextAreaElement): () => void {
  const vv = window.visualViewport;
  const timers: number[] = [];
  const apply = () => {
    const typing = document.activeElement === field;
    const height = vv?.height ?? window.innerHeight;
    const offset = vv?.offsetTop ?? 0;
    const keyboard = window.innerHeight - height - offset > 80;
    const open = typing && keyboard;
    document.body.classList.toggle('studio-typing', open);
    if (open) {
      document.documentElement.style.setProperty('--studio-vv-top', `${offset}px`);
      document.documentElement.style.setProperty('--studio-vv-h', `${height}px`);
    } else {
      document.documentElement.style.removeProperty('--studio-vv-top');
      document.documentElement.style.removeProperty('--studio-vv-h');
    }
  };
  const soon = () => {
    timers.forEach(clearTimeout);
    timers.length = 0;
    for (const ms of [0, 50, 300, 700]) timers.push(window.setTimeout(apply, ms));
  };
  field.addEventListener('focus', soon);
  field.addEventListener('blur', soon);
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  return () => {
    timers.forEach(clearTimeout);
    field.removeEventListener('focus', soon);
    field.removeEventListener('blur', soon);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    document.body.classList.remove('studio-typing');
    document.documentElement.style.removeProperty('--studio-vv-top');
    document.documentElement.style.removeProperty('--studio-vv-h');
  };
}

function playTip(onOk: (skip: boolean) => void): HTMLDialogElement {
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const ok = h('button', { class: 'btn btn-primary', type: 'button' }, '知道了') as HTMLButtonElement;
  const dialog = h(
    'dialog',
    { class: 'play-tip', 'aria-label': '播放说明' },
    h(
      'ol',
      {},
      h('li', {}, canFullscreen() ? '双击切换全屏，返回键退出播放' : '双击退出全屏播放'),
      h('li', {}, '右侧上下滑动，调节文字大小'),
      h('li', {}, '左侧上下滑动，调节滚动或闪烁速度'),
    ),
    h('label', { class: 'play-tip-skip' }, box, '以后不再提示'),
    ok,
  ) as HTMLDialogElement;
  ok.addEventListener('click', () => {
    const skip = box.checked;
    dialog.close();
    onOk(skip);
  });
  dialog.addEventListener('close', () => {
    box.checked = false;
  });
  return dialog;
}

function colorControl(title: string, hex: string): { button: HTMLButtonElement; input: HTMLInputElement; dialog: HTMLDialogElement } {
  const button = h('button', { class: 'color-field', type: 'button', title, 'aria-label': title }) as HTMLButtonElement;
  button.style.backgroundColor = `#${hex}`;
  const input = h('input', { type: 'color', 'aria-label': title }) as HTMLInputElement;
  input.value = `#${hex}`;
  const dialog = h(
    'dialog',
    { class: 'color-dialog' },
    h('form', { method: 'dialog' }, h('h2', {}, title), input, h('button', { class: 'btn btn-primary', type: 'submit' }, '完成')),
  ) as HTMLDialogElement;
  input.addEventListener('input', () => {
    button.style.backgroundColor = input.value;
  });
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  document.body.append(dialog);
  return { button, input, dialog };
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Some browsers only allow the older copy command during a click.
  }
  try {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.focus();
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  } catch {
    return false;
  }
}

function openDone(dialog: HTMLDialogElement, href: string, copied: boolean): void {
  const open = h('a', { class: 'btn btn-primary', href }, '全屏查看');
  open.addEventListener('click', () => sessionStorage.setItem(VIEWER_RETURN_KEY, location.href));
  dialog.replaceChildren(
    h('h2', {}, '定好了'),
    h(
      'p',
      {},
      copied
        ? location.protocol === 'file:'
          ? '链接已经复制。在这台电脑上打开，就是这块全屏牌子。'
          : '链接已经复制。在电视、平板或另一部手机上打开，就是这块全屏牌子。'
        : location.protocol === 'file:'
          ? '先全屏查看。地址在浏览器地址栏里，可以在这台电脑上再打开一次。'
          : '先全屏查看。地址在浏览器地址栏里，可以发给另一块屏幕。',
    ),
    h('div', { class: 'done-actions' }, open, h('button', { class: 'btn', type: 'button' }, '再改一改')),
  );
  dialog.querySelector('button')?.addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
  if (copied) toast('链接已复制');
}
