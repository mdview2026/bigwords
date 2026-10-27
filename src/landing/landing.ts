// The landing page's live pieces, attached over the markup that the build
// prerendered (landing-markup.ts renders the same string). Everything is
// scoped to the .lp root the markup carries, and destroy() leaves nothing
// behind: intervals, observers and window listeners all go.

import '../styles/landing.css';
import { sitePath } from '../paths';
import { landingMarkup } from './landing-markup';
import { APP_VERSION } from '../version';

/** The hero demo's color schemes: background/foreground hex pairs. */
const SCHEMES: { bg: string; fg: string }[] = [
  { bg: '111111', fg: 'ffd60a' },
  { bg: 'f6f3ea', fg: '16181d' },
  { bg: 'b00020', fg: 'ffffff' },
  { bg: '0a0f0a', fg: '3ddc84' },
  { bg: 'f9d5e5', fg: '4a2c40' },
];

const SLIDES = ['第一页', '第二页', '第三页'];

/** The hero demo's last state. 去全屏播放 is a hash-only jump into the viewer;
    Esc there comes back via history.back(), which remounts the whole landing
    from scratch (see main.ts). The module lives on across that round-trip, so
    the demo can pick up the words and scheme exactly where you left them. */
let demoState: { text: string; scheme: number } | null = null;

/** Scale one .lp-fit-text so it fills its .lp-fit-box without overflowing. */
function fit(box: Element): void {
  const el = box.querySelector<HTMLElement>('.lp-fit-text');
  if (!el) return;
  el.style.fontSize = '100px';
  const w = el.scrollWidth;
  const h = el.scrollHeight;
  const cs = getComputedStyle(box);
  const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (!w || !h || !availW || !availH) {
    el.style.fontSize = '';
    return;
  }
  const scale = Math.min(availW / w, availH / h);
  el.style.fontSize = `${Math.max(9, Math.floor(100 * scale))}px`;
}

export function mountLanding(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site page-landing';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const page = document.createElement('template');
  page.innerHTML = landingMarkup(APP_VERSION);
  app.replaceChildren(page.content);
  const root = app.querySelector<HTMLElement>('.lp')!;

  /* ---- In-page anchors: the fragment belongs to the viewer, so the nav
     scrolls without touching location.hash. Without JavaScript the browser's
     own anchor scroll still works. ---- */
  const onAnchorClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const target = root.querySelector(link.hash || '#top');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };
  root.addEventListener('click', onAnchorClick);

  /* ---- The hero demo: type words and the phone's screen runs them as a
     scrolling subtitle; pick a scheme, then open the real display. ---- */
  const screen = root.querySelector<HTMLElement>('#lpDemoScreen')!;
  const phoneTrack = root.querySelector<HTMLElement>('#lpPhoneTrack')!;
  const input = root.querySelector<HTMLInputElement>('#lpDemoInput')!;
  const play = root.querySelector<HTMLAnchorElement>('#lpDemoPlay')!;
  const swatches = root.querySelector<HTMLElement>('#lpDemoSwatches')!;
  let scheme = SCHEMES[0];

  for (const [i, s] of SCHEMES.entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lp-swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `配色 ${i + 1}`);
    b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    b.style.background = `#${s.bg}`;
    b.addEventListener('click', () => {
      scheme = s;
      for (const other of swatches.children) other.setAttribute('aria-checked', other === b ? 'true' : 'false');
      applyDemo();
    });
    swatches.append(b);
  }

  /** Fit the line to the phone screen's height, then clone it into an even
      number of copies whose half is at least the screen wide — the track's
      -50% CSS loop stays seamless for any width (the page ticker does the
      same). Duration follows the text's size, so the pace feels equal whether
      the line is long or short. */
  const renderMarquee = (text: string, faded: boolean) => {
    const W = screen.clientWidth;
    const H = screen.clientHeight;
    if (!W || !H) return;
    const fontPx = Math.max(10, Math.round(H * 0.56));
    let span = phoneTrack.firstElementChild as HTMLElement | null;
    if (!span) {
      span = document.createElement('span');
      span.className = 'lp-phone-text';
      phoneTrack.append(span);
    }
    const style = (el: HTMLElement) => {
      el.textContent = text;
      el.style.fontSize = `${fontPx}px`;
      el.style.opacity = faded ? '.35' : '';
    };
    style(span);
    const unit = span.getBoundingClientRect().width + fontPx * 0.6; // + the .6em gap
    let copies = Math.min(16, Math.max(2, Math.ceil((W * 2) / unit + 0.5)));
    if (copies % 2) copies++;
    while (phoneTrack.children.length > copies) phoneTrack.lastElementChild!.remove();
    for (const el of phoneTrack.children) if (el !== span) style(el as HTMLElement);
    while (phoneTrack.children.length < copies) {
      const el = document.createElement('span');
      el.className = 'lp-phone-text';
      style(el);
      phoneTrack.append(el);
    }
    const half = (copies / 2) * unit;
    phoneTrack.style.setProperty('--lp-mq-dur', `${Math.max(3, half / (fontPx * 0.75)).toFixed(2)}s`);
  };

  const applyDemo = () => {
    const text = input.value.replace(/\s+$/, '');
    screen.style.background = `#${scheme.bg}`;
    screen.style.color = `#${scheme.fg}`;
    renderMarquee(text || '…', !text);
    play.href = new URL(sitePath(`/#${encodeURIComponent(text || '大字屏')}&bg=${scheme.bg}&fg=${scheme.fg}&anim=scroll`), location.href).href;
    demoState = { text: input.value, scheme: SCHEMES.indexOf(scheme) };
  };
  const onDemoInput = () => applyDemo();
  const onDemoEnter = (event: KeyboardEvent) => {
    // Same-tab like the play link itself: the hash-only navigation keeps the
    // keypress's transient activation, so playback opens in true fullscreen.
    if (event.key === 'Enter') location.assign(play.href);
  };
  input.addEventListener('input', onDemoInput);
  input.addEventListener('keydown', onDemoEnter);
  // Back from the viewer: the markup was rebuilt, so put the demo back where
  // the fullscreen play interrupted it.
  if (demoState) {
    input.value = demoState.text;
    const idx = Math.min(Math.max(demoState.scheme, 0), SCHEMES.length - 1);
    scheme = SCHEMES[idx];
    for (const [i, other] of Array.from(swatches.children).entries())
      other.setAttribute('aria-checked', i === idx ? 'true' : 'false');
  }
  applyDemo();

  /* ---- The ticker: clone its chips until there are two identical halves
     wider than the viewport, so the -50% loop never shows a seam. ---- */
  const track = root.querySelector<HTMLElement>('#lpTickerTrack')!;
  if (track && !reduced) {
    const base = track.innerHTML;
    let copies = 1;
    while (track.scrollWidth < innerWidth * 2 && copies < 8) {
      track.innerHTML += base;
      copies++;
    }
    if (copies % 2 === 1) track.innerHTML += base;
  }

  /* ---- The live countdown card: time to the next full hour. ---- */
  const count = root.querySelector<HTMLElement>('#lpLiveCount');
  const pad = (n: number) => String(n).padStart(2, '0');
  let countTimer = 0;
  if (count) {
    const tick = () => {
      const now = new Date();
      const next = new Date(now);
      next.setMinutes(60, 0, 0);
      const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
      count.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    };
    tick();
    countTimer = window.setInterval(tick, 1000);
  }

  /* ---- The slides card: rotate pages on a fade. ---- */
  const slide = root.querySelector<HTMLElement>('#lpLiveSlide');
  let slideTimer = 0;
  if (slide && !reduced) {
    let i = 0;
    slideTimer = window.setInterval(() => {
      slide.classList.add('lp-out');
      window.setTimeout(() => {
        i = (i + 1) % SLIDES.length;
        slide.textContent = SLIDES[i];
        slide.classList.remove('lp-out');
      }, 380);
    }, 2400);
  }

  /* ---- Refit every fitted text when the window changes size. ---- */
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      root.querySelectorAll('.lp-fit-box').forEach(fit);
      applyDemo(); // the phone marquee refits its size and copy count too
    }, 120);
  };
  window.addEventListener('resize', onResize);

  /* ---- Scroll-reveal, only once the runtime owns the markup. ---- */
  const reveals = [...root.querySelectorAll('.lp-reveal')];
  let io: IntersectionObserver | null = null;
  if (!reduced && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('lp-in');
            io!.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -36px' },
    );
    root.classList.add('lp-ready');
    for (const el of reveals) io.observe(el);
  }

  /* ---- The sticky nav gets a shadow once the page scrolls. ---- */
  const nav = root.querySelector<HTMLElement>('#lpNav');
  const onScroll = () => nav?.classList.toggle('lp-scrolled', scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  return {
    destroy() {
      root.removeEventListener('click', onAnchorClick);
      input.removeEventListener('input', onDemoInput);
      input.removeEventListener('keydown', onDemoEnter);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      clearTimeout(resizeTimer);
      clearInterval(countTimer);
      clearInterval(slideTimer);
      io?.disconnect();
    },
  };
}
