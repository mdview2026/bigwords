import './styles/site.css';
import './styles/simple.css';
import { ensureFont } from './render/fonts';
import { parseFragment } from './state/fragment';
import { resolveSettings } from './state/params';
import { sitePath } from './paths';
import { apkUrl } from './pages';
import { APP_VERSION } from './version';
import { Display } from './render/display';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Site header shared by the chooser, guide, docs, editor and the not-found page. Uses Bebas Neue for the wordmark. */
export function siteHeader(current?: 'home' | 'editor' | 'docs' | 'guide', extra?: Node): HTMLElement {
  void ensureFont(4);
  const link = (href: string, label: string, key: string) =>
    h('a', { href, 'aria-current': current === key ? 'page' : undefined }, label);
  // The chooser is for ordinary users, so the header does not offer the parameter reference.
  // Instead it carries the installer download: an <a> so it still works without
  // JavaScript (direct download); the chooser intercepts the click and shows a
  // QR code instead, which is how desktop users get the APK onto a phone.
  const nav =
    current === 'home'
      ? h('a', { class: 'btn btn-primary btn-sm', href: apkUrl(APP_VERSION), 'data-apk': true }, '下载安装版')
      : h('nav', { class: 'site-nav' }, link(sitePath('/'), '首页', 'home'), link(sitePath('/docs'), 'Docs', 'docs'), extra ?? null);
  return h(
    'header',
    { class: 'site-header' },
    h('a', { class: 'wordmark', href: sitePath('/'), 'aria-label': '大字屏 home' }, '大字屏'),
    nav,
  );
}

/** Render a fragment into an element, exactly as the viewer would. */
export function previewDisplay(target: HTMLElement, fragment: string): Display {
  const d = new Display(target);
  d.update(resolveSettings(parseFragment(fragment)));
  return d;
}

let toastTimer = 0;
export function toast(message: string): void {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), 1800);
}
