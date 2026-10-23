import { h } from '../chrome';
import { apkUrl } from '../pages';
import { APP_VERSION } from '../version';

// The installer dialog opened by the home page's 下载安装版 button: a QR code
// a phone can scan, plus a direct link for visitors already on Android. Both
// point at this build's versioned APK file, which never changes under them. A
// native <dialog> supplies the modal behaviour (Esc, focus trap, backdrop);
// the QR chunk (~20 kB) only loads on demand.
let dialog: HTMLDialogElement | null = null;
let opening = false;

/** Close and drop the dialog, if it is open (also used by the gallery teardown). */
export function closeApkDialog(): void {
  dialog?.close();
}

export async function openApkDialog(): Promise<void> {
  if (dialog || opening) {
    dialog?.showModal();
    return;
  }
  opening = true;
  try {
    const url = apkUrl(APP_VERSION);
    const { createQrSvg } = await import('../render/qr');
    const qr = createQrSvg(url);
    if (!qr) return; // The URL cannot happen to be too long for a QR; stay silent.
    qr.setAttribute('aria-hidden', 'true');
    const close = h('button', { class: 'btn', type: 'button' }, '关闭');
    const d = h(
      'dialog',
      { class: 'apk-dialog', 'aria-label': '下载安装版' },
      h('strong', { class: 'apk-title' }, '下载安装版'),
      h('div', { class: 'apk-qr' }, qr),
      h('p', { class: 'apk-hint' }, '用手机扫码，安装 Android 版'),
      h('div', { class: 'apk-actions' }, h('a', { class: 'btn btn-primary', href: url }, '直接下载 APK'), close),
    );
    close.addEventListener('click', () => d.close());
    // A click that reaches the dialog element itself landed on the backdrop.
    d.addEventListener('click', (event) => {
      if (event.target === d) d.close();
    });
    d.addEventListener('close', () => {
      d.remove();
      if (dialog === d) dialog = null;
    });
    dialog = d;
    document.body.append(d);
    d.showModal();
  } finally {
    opening = false;
  }
}
