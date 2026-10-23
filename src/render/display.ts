import type { Settings } from '../state/params';
import { sizeToPx, type SizeValue } from '../state/size';
import { noteWallStart, wallElapsed, wallMarquee, wallShift, type Wall } from '../wall';
import { formatCountdown, everySecond } from './countdown';
import { drawChipX, drawPlan, drawWinner } from './draw';
import { ensureFont, fontReady, fontStack } from './fonts';
import { COUNTDOWN_TOKEN, parseMessage, parseSingle, type Slide } from './text';

export interface DisplayOptions {
  /** Editor preview: draws the ratio frame. */
  editor?: boolean;
  onImageError?: (url: string) => void;
  onImageLoad?: (url: string) => void;
}

const SPEED_FACTOR = { slow: 2, normal: 1, fast: 0.5 } as const;
const PACE_MIN = 0.25;
const PACE_MAX = 4;
const BASE_DURATION: Record<string, number> = {
  pulse: 2,
  flash: 1,
  shake: 0.4,
  bounce: 1,
  fadein: 1.5,
  rainbow: 6,
};
const SLIDE_TRANSITION_MS = 600;
/** Motions that repeat, and so can be put at a shared point in their cycle. */
const WALL_SYNCED = new Set(['pulse', 'flash', 'shake', 'bounce', 'rainbow', 'scroll']);
const CODE_FONT = 5; // JetBrains Mono, loaded only when a message has `code`
const FONT_WAIT_MS = 1500; // longest the text stays hidden waiting for its font

type FitMode = 'both' | 'height' | 'width';

interface SlideView {
  slide: Slide;
  el: HTMLElement; // full-area layer
  wrap: HTMLElement; // wall offset; carries the slide sideways, never animates
  block: HTMLElement; // the text block
  stopAnim?: () => void;
  wallResync?: (elapsed: number) => void; // re-join the wall's shared progress
}

function prefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
}

function luminance(hex: string): number {
  const n = parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const MEASURE_PX = 100;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

interface Ink {
  width: number; // advance width
  left: number; // ink past the start of the advance box
  right: number; // ink past the end of the advance box
  ascent: number; // ink above the baseline
  descent: number; // ink below the baseline
  fontAscent?: number;
  fontDescent?: number;
}
const inkCache = new Map<string, Ink>();
// Cached results depend on which fonts were loaded when measured.
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => inkCache.clear());
}

/**
 * Where a run of text really puts ink, found by drawing it and scanning the
 * pixels. Canvas text metrics (actualBoundingBox*) are not trustworthy for
 * this: Safari reports Caveat's overhangs short of what it draws.
 */
function measureInk(ctx: CanvasRenderingContext2D, text: string, font: string, ready: boolean): Ink {
  // Whether the web font is ready is part of the key, so a measurement taken
  // with a fallback font is never reused once the real one loads.
  const key = `${ready}\n${font}\n${text}`;
  const hit = inkCache.get(key);
  if (hit) return hit;
  ctx.font = font;
  const m = ctx.measureText(text);
  const M = MEASURE_PX;
  const w = Math.ceil(m.width + 2 * M);
  const h = 3 * M;
  const cv = ctx.canvas;
  if (cv.width < w) cv.width = w;
  if (cv.height < h) cv.height = h;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.font = font; // resizing the canvas resets its state
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  ctx.fillText(text, M, 2 * M);
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const ink: Ink =
    maxX < 0
      ? { width: m.width, left: 0, right: 0, ascent: 0, descent: 0 }
      : { width: m.width, left: M - minX, right: maxX + 1 - (M + m.width), ascent: 2 * M - minY, descent: maxY + 1 - 2 * M };
  ink.fontAscent = m.fontBoundingBoxAscent;
  ink.fontDescent = m.fontBoundingBoxDescent;
  inkCache.set(key, ink);
  return ink;
}

/**
 * How far the block's glyph ink extends past its layout boxes, in em of the
 * block's base size: [top, right, bottom, left]. Some fonts draw outside the
 * space they reserve for a character (Caveat's slanted strokes and swashes,
 * italic faces), and since text is fitted against layout boxes, that ink was
 * clipped at the edges of the text area. Padding the block by these amounts
 * makes the fit leave room for it, and centers the ink rather than the boxes.
 */
function inkOverhang(block: HTMLElement): [number, number, number, number] {
  measureCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = measureCtx;
  if (!ctx) return [0, 0, 0, 0];
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  // document.fonts.check is slow, so ask once per font per call.
  const readyByFont = new Map<string, boolean>();
  const fontReady = (font: string) => {
    let r = readyByFont.get(font);
    if (r === undefined) {
      r = document.fonts ? document.fonts.check(font) : true;
      readyByFont.set(font, r);
    }
    return r;
  };
  const lines = [...block.querySelectorAll<HTMLElement>(':scope > .bw-line')];
  lines.forEach((line, li) => {
    const scale = line.classList.contains('bw-h1') ? 2 : line.classList.contains('bw-h2') ? 1.5 : 1;
    const lineHeight = scale > 1 ? 1.1 : 1.15;
    const em = scale / MEASURE_PX;
    const firstLine = li === 0;
    const lastLine = li === lines.length - 1;
    // Each character with the style it's drawn in.
    const chars: { c: string; font: string }[] = [];
    for (const span of line.querySelectorAll<HTMLElement>(':scope > span')) {
      const cs = getComputedStyle(span);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${MEASURE_PX}px ${cs.fontFamily}`;
      for (const c of Array.from(span.textContent ?? '')) chars.push({ c, font });
    }
    // Measure runs of same-style, non-space characters rather than single
    // characters: script fonts like Caveat pick contextual glyph variants, so a
    // letter's ink depends on its neighbours.
    let i = 0;
    while (i < chars.length) {
      if (isSpace(chars[i].c)) {
        i++;
        continue;
      }
      let j = i;
      let text = '';
      while (j < chars.length && !isSpace(chars[j].c) && chars[j].font === chars[i].font) text += chars[j++].c;
      // Lines never wrap, so only a line's first and last runs reach its edges.
      const atStart = i === 0;
      const atEnd = j === chars.length;
      if (atStart || atEnd || firstLine || lastLine) {
        const ink = measureInk(ctx, text, chars[i].font, fontReady(chars[i].font));
        if (atStart) left = Math.max(left, ink.left * em);
        if (atEnd) right = Math.max(right, ink.right * em);
        if ((firstLine || lastLine) && ink.fontAscent !== undefined && ink.fontDescent !== undefined) {
          const halfLeading = (lineHeight * MEASURE_PX - (ink.fontAscent + ink.fontDescent)) / 2;
          if (firstLine) top = Math.max(top, (ink.ascent - ink.fontAscent - halfLeading) * em);
          if (lastLine) bottom = Math.max(bottom, (ink.descent - ink.fontDescent - halfLeading) * em);
        }
      }
      i = j;
    }
  });
  // A small margin for antialiasing and rendering differences between the
  // canvas and the page.
  const pad = (n: number) => (n > 0 ? n * 1.05 + 0.02 : 0);
  return [pad(top), pad(right), pad(bottom), pad(left)];
}

/**
 * Renders a Settings object into a container. Used by the fullscreen viewer,
 * the editor preview and the home page demo, so all three always match.
 */
export class Display {
  private root: HTMLElement;
  private opts: DisplayOptions;
  private s: Settings | null = null;

  private box = el('div', 'bw-box');
  private bgImg: HTMLImageElement | null = null;
  private content = el('div', 'bw-content');
  private area = el('div', 'bw-area');
  private flowImg: HTMLImageElement | null = null;
  private qrWrap: HTMLElement | null = null;

  private views: SlideView[] = [];
  private current = 0;
  private slideTimer = 0;
  private stopTick: (() => void) | null = null;
  private expired = false;
  private cdText = '';
  /** This screen's slice of a multi-screen sign, or null for an ordinary sign. */
  private wall: Wall | null = null;
  /** The lucky-draw chip, flying while `anim` is `draw`. */
  private drawChip: HTMLElement | null = null;
  private drawFrame = 0;
  private drawT0 = 0; // local clock for a draw that no controller started
  /** Distance from the stage's left edge to the text area, in px. */
  private contentLeft = 0;
  /** The wall's text layout, shared by every screen: outer margins, total text width, and this screen's share of it. */
  private wallPadLeft = 0;
  private wallTextW = 0;
  private perScreenW = 0;
  private wallTimer = 0;
  private onWallStart = () => this.updateWallAnimation();
  /** When the countdown ends, in ms since the epoch, from `until` or `timer`. */
  private deadline: number | null = null;
  /** The running timer: its length and when it started. It restarts only when the length changes. */
  private timer: { seconds: number; start: number } | null = null;
  private resizeObs: ResizeObserver;
  private areaObs: ResizeObserver;
  private media: MediaQueryList | null = null;
  private onScheme = () => this.applyColors();
  // Faces the fit didn't wait for (italic, latin-ext, a lazily loaded bold)
  // can land later and change the text's metrics.
  private onFonts = () => this.scheduleFit();
  private destroyed = false;
  private fitFrame = 0;
  private rateFrame = 0;
  private revealTimer = 0;

  constructor(root: HTMLElement, opts: DisplayOptions = {}) {
    this.root = root;
    this.opts = opts;
    root.classList.add('bw-stage');
    if (opts.editor) root.classList.add('bw-editor');
    this.content.append(this.area);
    this.box.append(this.content);
    root.append(this.box);
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(root);
    this.areaObs = new ResizeObserver(() => this.scheduleFit());
    this.areaObs.observe(this.area);
    if (typeof matchMedia === 'function') {
      this.media = matchMedia('(prefers-color-scheme: light)');
      this.media.addEventListener('change', this.onScheme);
    }
    document.fonts?.addEventListener('loadingdone', this.onFonts);
    window.addEventListener('bw-wall', this.onWallStart);
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.stopDraw();
    clearInterval(this.wallTimer);
    this.wallTimer = 0;
    window.removeEventListener('bw-wall', this.onWallStart);
    clearTimeout(this.revealTimer);
    this.views.forEach((v) => v.stopAnim?.());
    this.resizeObs.disconnect();
    this.areaObs.disconnect();
    this.media?.removeEventListener('change', this.onScheme);
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    cancelAnimationFrame(this.fitFrame);
    cancelAnimationFrame(this.rateFrame);
    this.root.replaceChildren();
    this.root.classList.remove('bw-stage', 'bw-editor', 'bw-wall');
    this.root.removeAttribute('style');
  }

  /**
   * Change the font size and refit. The existing text stays in place, so a
   * scroll-wheel resize does not restart animations or hide the message
   * while fonts load again.
   */
  setSize(size: SizeValue | null): void {
    if (!this.s) return;
    this.s.size = size;
    this.fitAll();
  }

  /** Current playback rate. 1 is normal, larger is faster. */
  pace(): number {
    return this.rate();
  }

  /**
   * Change how fast scroll, flash, and the other motions run, without
   * rebuilding the text. 1 is normal speed.
   */
  setPace(pace: number): void {
    if (!this.s || !Number.isFinite(pace)) return;
    this.s.pace = Math.min(PACE_MAX, Math.max(PACE_MIN, pace));
    this.applyRate();
  }

  /** Change colors in place. `bg` and `fg` are 6-digit hex without '#', or null for auto. */
  setColors(bg: string | null, fg: string | null): void {
    if (!this.s) return;
    this.s.bg = bg;
    this.s.fg = fg;
    this.applyColors();
  }

  update(settings: Settings): void {
    this.s = settings;
    this.clearTimers();
    this.stopDraw();
    this.applyColors();
    // The lucky draw flies its chip across the wall, but each screen's own
    // number is an ordinary sign centred on that screen, so the wall's shared
    // text layout must not shift it. The wall itself is read from the
    // settings in drawTick.
    this.wall = settings.anim === 'draw' ? null : settings.wall;
    this.root.classList.toggle('bw-wall', !!this.wall);
    if (this.wall) {
      // A screen opening a wall link on its own starts the clock now; the
      // screens a controller drives are told the moment in player-link.
      if (wallElapsed() === null) noteWallStart();
      clearInterval(this.wallTimer);
      this.wallTimer = window.setInterval(() => this.updateWallAnimation(), 1000);
    } else {
      clearInterval(this.wallTimer);
      this.wallTimer = 0;
    }

    const family = fontStack(settings.font);
    this.box.style.fontFamily = family;
    this.box.style.setProperty('--bw-code-font', fontStack(CODE_FONT));

    this.box.dataset.speed = settings.speed;
    const base = BASE_DURATION[settings.anim];
    // Duration is the normal speed. playbackRate (applyRate) makes it faster or slower
    // so a drag can change the speed without starting the motion over.
    if (base) this.box.style.setProperty('--bw-dur', `${base}s`);

    this.box.classList.toggle('bw-ratio', !!settings.ratio);
    this.buildImage();
    this.buildQr();
    this.deadline = this.countdownDeadline(settings);
    this.expired = this.deadline !== null && Date.now() >= this.deadline;
    this.cdText = this.deadline !== null ? formatCountdown(this.deadline - Date.now(), settings.cdfmt) : '';
    this.buildSlides();
    this.layout();
    if (settings.anim === 'draw') this.startDraw();

    if (this.deadline !== null) {
      this.stopTick = everySecond(() => this.tick());
    }
  }

  /**
   * A timer starts on the next whole second after it is first shown, so it
   * ticks in step with the clock and shows its full length for that first
   * moment. It works from that start time rather than counting ticks, so it
   * stays right when a background tab's timers are throttled.
   */
  private countdownDeadline(settings: Settings): number | null {
    if (settings.timer === null) {
      this.timer = null;
      return settings.until ? settings.until.getTime() : null;
    }
    if (this.timer?.seconds !== settings.timer) {
      this.timer = { seconds: settings.timer, start: Math.ceil(Date.now() / 1000) * 1000 };
    }
    return this.timer.start + this.timer.seconds * 1000;
  }

  // ---------------------------------------------------------------- colors

  private colors(): { bg: string; fg: string } {
    const s = this.s!;
    const light = prefersLight();
    return {
      bg: '#' + (s.bg ?? (light ? 'ffffff' : '000000')),
      fg: '#' + (s.fg ?? (light ? '000000' : 'ffffff')),
    };
  }

  private applyColors(): void {
    if (!this.s) return;
    const { bg, fg } = this.colors();
    this.root.style.backgroundColor = bg;
    this.box.style.backgroundColor = bg;
    this.box.style.setProperty('--bw-bg', bg);
    this.box.style.color = fg;
    // Rainbow keeps contrast against the background.
    this.box.style.setProperty('--bw-rb-l', luminance(bg.slice(1)) > 0.4 ? '38%' : '62%');
  }

  // ---------------------------------------------------------------- image & QR

  private makeImg(url: string): HTMLImageElement {
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    // No crossOrigin: the pixels are never read, and requiring CORS made
    // images from most hosts fail.
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.hidden = true;
      this.opts.onImageError?.(url);
    });
    img.addEventListener('load', () => {
      img.hidden = false;
      this.opts.onImageLoad?.(url);
      this.scheduleFit();
    });
    img.src = url;
    return img;
  }

  private buildImage(): void {
    const s = this.s!;
    const wantBg = s.img && (s.imgpos === 'bg' || s.imgpos === 'full') ? s.img : null;
    const wantFlow = s.img && (s.imgpos === 'above' || s.imgpos === 'below') ? s.img : null;

    // Reuse an existing element for the same URL so editor edits don't flicker.
    const reuse = [this.bgImg, this.flowImg].find((i) => i && i.getAttribute('src') === s.img) ?? null;
    const take = (url: string | null): HTMLImageElement | null => {
      if (!url) return null;
      if (reuse && reuse.getAttribute('src') === url) return reuse;
      return this.makeImg(url);
    };
    const bg = take(wantBg);
    const flow = take(wantFlow);
    for (const old of [this.bgImg, this.flowImg]) if (old && old !== bg && old !== flow) old.remove();
    this.bgImg = bg;
    this.flowImg = flow;

    if (bg) {
      bg.className = `bw-img-layer bw-img-${s.imgpos}`;
      this.box.prepend(bg);
    }
    if (flow) {
      flow.className = 'bw-img-flow';
      if (s.imgpos === 'above') this.content.insertBefore(flow, this.area);
      else this.area.after(flow);
    }
  }

  private buildQr(): void {
    const s = this.s!;
    this.qrWrap?.remove();
    this.qrWrap = null;
    if (!s.qr) return;
    const wrap = el('div', `bw-qr bw-qr-${s.qrpos}`);
    if (s.qrpos === 'below') {
      // After the text area (and after a "below" image).
      this.content.append(wrap);
    } else {
      this.box.append(wrap);
    }
    this.qrWrap = wrap;
    // The QR encoder is only downloaded when a display uses it.
    const text = s.qr;
    void Promise.all([import('./qr'), import('../state/qr-payload')]).then(([{ createQrSvg }, { qrCodeText }]) => {
      if (this.qrWrap !== wrap) return;
      const svg = createQrSvg(qrCodeText(text));
      if (svg) wrap.append(svg);
      else wrap.remove();
    });
  }

  // ---------------------------------------------------------------- slides

  private activeSlides(): Slide[] {
    const s = this.s!;
    let message = s.message;
    if (this.deadline !== null && message.trim() === '') message = COUNTDOWN_TOKEN;
    const slides = parseMessage(message);
    if (this.deadline === null || !this.expired) return slides;
    const zero = s.zero;
    if (zero.kind === 'freeze') return slides;
    if (slides.length === 1) {
      return zero.kind === 'hide' ? [] : [parseSingle(zero.message)];
    }
    if (zero.kind === 'hide') return slides.filter((sl) => !sl.hasCountdown);
    const replacement = parseSingle(zero.message);
    return slides.map((sl) => (sl.hasCountdown ? replacement : sl));
  }

  private renderBlock(slide: Slide): HTMLElement {
    const block = el('div', 'bw-block');
    for (const line of slide.lines) {
      const ln = el('div', line.level ? `bw-line bw-h${line.level}` : 'bw-line');
      if (line.runs.length === 0) ln.append(document.createElement('br'));
      for (const run of line.runs) {
        const span = el('span');
        if (run.bold) span.classList.add('bw-b');
        if (run.italic) span.classList.add('bw-i');
        if (run.strike) span.classList.add('bw-s');
        if (run.code) span.classList.add('bw-code');
        if (run.countdown) {
          if (this.deadline !== null) {
            span.classList.add('bw-cd');
            span.textContent = this.cdText;
          } else {
            span.textContent = COUNTDOWN_TOKEN;
          }
        } else {
          span.textContent = run.text;
        }
        ln.append(span);
      }
      block.append(ln);
    }
    return block;
  }

  private buildSlides(): void {
    const s = this.s!;
    this.views.forEach((v) => v.stopAnim?.());
    this.area.replaceChildren();
    this.views = this.activeSlides().map((slide) => {
      const layer = el('div', `bw-slide bw-mode-${this.fitMode()}`);
      const block = this.renderBlock(slide);
      if (s.anim !== 'none') block.classList.add(`bw-anim-${s.anim}`);
      // On a wall the text block is slid sideways by a wrapper, so an
      // animation on the block itself (shake, pulse, the marquee) never has
      // to know about it.
      const wrap = el('div', 'bw-shift');
      wrap.append(block);
      layer.append(wrap);
      layer.hidden = true;
      this.area.append(layer);
      return { slide, el: layer, wrap, block };
    });
    this.current = 0;
    if (this.views.length) this.show(0);
    if (this.views.length > 1) {
      this.slideTimer = window.setInterval(() => this.advance(), s.interval * 1000);
    }
    // Load the faces the text uses before fitting. The bold face is only
    // requested when something is bold (headings are bold).
    const fonts = new Set<number>();
    if (s.font !== 0) fonts.add(s.font);
    if (this.area.querySelector('.bw-code')) fonts.add(CODE_FONT);
    const bold = !!this.area.querySelector('.bw-b, .bw-h1, .bw-h2');
    // Keep the text hidden until its faces arrive, so it doesn't paint in a
    // fallback font and then visibly swap. A slow network gets a short cap.
    const pending = [...fonts].filter((id) => !fontReady(id, { bold }));
    this.area.style.visibility = pending.length ? 'hidden' : '';
    clearTimeout(this.revealTimer);
    if (!pending.length) return;
    const reveal = () => {
      if (this.destroyed || this.s !== s) return;
      clearTimeout(this.revealTimer);
      this.area.style.visibility = '';
      this.scheduleFit();
    };
    this.revealTimer = window.setTimeout(reveal, FONT_WAIT_MS);
    void Promise.all(pending.map((id) => ensureFont(id, { bold }))).then(reveal);
  }

  private show(i: number): void {
    const v = this.views[i];
    v.el.hidden = false;
    v.el.style.transform = '';
    this.fit(v);
    this.startAnim(v);
  }

  private advance(): void {
    if (this.views.length < 2 || document.hidden) return;
    const from = this.views[this.current];
    this.current = (this.current + 1) % this.views.length;
    const to = this.views[this.current];
    to.el.hidden = false;
    this.fit(to);
    this.startAnim(to);
    const opts: KeyframeAnimationOptions = { duration: SLIDE_TRANSITION_MS, easing: 'ease-in-out' };
    if (typeof to.el.animate === 'function') {
      to.el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], opts);
      const out = from.el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], opts);
      out.onfinish = () => {
        if (this.views[this.current] !== from) {
          from.el.hidden = true;
          from.stopAnim?.();
        }
      };
    } else {
      from.el.hidden = true;
    }
  }

  private visibleViews(): SlideView[] {
    return this.views.filter((v) => !v.el.hidden);
  }

  // ---------------------------------------------------------------- lucky draw

  /**
   * Fly the chip across the wall. Every screen computes the same flight from
   * the wall's shared clock and the seed in the URL, so the chip crosses the
   * seams without the screens ever comparing notes. Off a wall (an editor
   * preview, a lone screen) it shuttles within the one screen on a local
   * clock.
   */
  private startDraw(): void {
    this.stopDraw();
    const chip = el('div', 'bw-draw-chip');
    chip.append(el('div'));
    this.box.append(chip);
    this.drawChip = chip;
    this.drawT0 = performance.now();
    const tick = () => {
      this.drawFrame = requestAnimationFrame(tick);
      this.drawTick();
    };
    tick();
  }

  private stopDraw(): void {
    cancelAnimationFrame(this.drawFrame);
    this.drawFrame = 0;
    this.drawChip?.remove();
    this.drawChip = null;
    this.box.classList.remove('bw-draw-done', 'bw-draw-won');
  }

  private drawTick(): void {
    const s = this.s;
    const chip = this.drawChip;
    if (!s || !chip) return;
    const boxW = this.box.clientWidth;
    if (boxW <= 0) return;
    const total = s.wall?.total ?? 1;
    const slot = s.wall?.slot ?? 1;
    const winner = drawWinner(s.drawSeed, total);
    const plan = drawPlan(boxW, total, winner);
    const t = s.wall ? (wallElapsed() ?? 0) : (performance.now() - this.drawT0) / 1000;
    // The flight is in wall pixels; this screen shows its own slice of it.
    const x = drawChipX(plan, t) - (slot - 1) * boxW;
    chip.style.width = `${plan.chipW.toFixed(1)}px`;
    chip.style.transform = `translateX(${(x - plan.chipW / 2).toFixed(1)}px)`;
    const done = t >= plan.seconds;
    this.box.classList.toggle('bw-draw-done', done);
    this.box.classList.toggle('bw-draw-won', done && slot === winner);
  }

  // ---------------------------------------------------------------- countdown

  private tick(): void {
    const s = this.s;
    if (!s || this.deadline === null) return;
    const remaining = this.deadline - Date.now();
    const text = formatCountdown(remaining, s.cdfmt);
    const nowExpired = remaining <= 0;
    if (nowExpired && !this.expired) {
      this.expired = true;
      this.cdText = text;
      if (s.zero.kind !== 'freeze') {
        clearInterval(this.slideTimer);
        this.buildSlides();
        this.scheduleFit();
        return;
      }
    }
    const lengthChanged = text.length !== this.cdText.length;
    this.cdText = text;
    this.area.querySelectorAll<HTMLElement>('.bw-cd').forEach((span) => {
      span.textContent = text;
    });
    if (lengthChanged) this.scheduleFit();
    if (nowExpired && this.stopTick && s.zero.kind !== 'freeze') {
      this.stopTick();
      this.stopTick = null;
    }
  }

  private clearTimers(): void {
    clearInterval(this.slideTimer);
    this.slideTimer = 0;
    this.stopTick?.();
    this.stopTick = null;
  }

  // ---------------------------------------------------------------- layout & fit

  private layout(): void {
    const s = this.s;
    if (!s) return;
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    let bw = W;
    let bh = H;
    if (s.ratio) {
      const r = s.ratio[0] / s.ratio[1];
      if (W / H > r) bw = H * r;
      else bh = W / r;
    }
    bw = Math.max(0, Math.round(bw));
    bh = Math.max(0, Math.round(bh));
    Object.assign(this.box.style, {
      width: `${bw}px`,
      height: `${bh}px`,
      left: `${Math.round((W - bw) / 2)}px`,
      top: `${Math.round((H - bh) / 2)}px`,
    });
    // A lucky draw always parks each screen's number in the top half, so the
    // chip owns the middle band whatever padding the URL carries.
    const [pt, pr, pb, pl] = s.anim === 'draw' ? [5, 5, 48, 5] : s.pad;
    this.contentLeft = (pl / 100) * bw;
    // The wall's text is laid out on a canvas `total` screens wide with the
    // margins only at its outer edges. Every screen works this out the same
    // way, so they agree on where the seams fall.
    this.wallPadLeft = (pl / 100) * bw;
    this.wallTextW = bw * (this.wall?.total ?? 1) - ((pl + pr) / 100) * bw;
    this.perScreenW = this.wallTextW / (this.wall?.total ?? 1);
    Object.assign(this.content.style, {
      top: `${(pt / 100) * bh}px`,
      right: `${(pr / 100) * bw}px`,
      bottom: `${(pb / 100) * bh}px`,
      left: `${(pl / 100) * bw}px`,
    });
    if (this.qrWrap) {
      const q = Math.max(48, Math.round((Math.min(bw, bh) * s.qrsize) / 100));
      const m = Math.round(Math.min(bw, bh) * 0.03);
      this.qrWrap.style.setProperty('--bw-qr', `${q}px`);
      this.qrWrap.style.setProperty('--bw-qr-m', `${m}px`);
    }
    this.fitAll();
  }

  private scheduleFit(): void {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fitAll());
  }

  private fitAll(): void {
    for (const v of this.visibleViews()) this.fit(v);
    this.applyWallShift();
  }

  /**
   * Slide every screen's text sideways so the screens show one wide sign
   * between them. Screen `slot` shows the slice that starts `slot - 1` screens
   * into the wall, so its text moves left as the number grows.
   */
  private applyWallShift(): void {
    if (!this.wall) return;
    const boxW = this.box.clientWidth;
    const areaW = this.area.clientWidth;
    if (boxW <= 0 || areaW <= 0) return;
    const shift = wallShift(boxW, this.wallPadLeft, this.wallTextW, this.contentLeft, areaW, this.wall);
    for (const v of this.views) v.wrap.style.transform = `translateX(${shift.toFixed(2)}px)`;
  }

  private fitMode(): FitMode {
    const anim = this.s?.anim;
    return anim === 'scroll' ? 'height' : anim === 'crawl' ? 'width' : 'both';
  }

  private fit(v: SlideView): void {
    const s = this.s!;
    const W = this.area.clientWidth;
    const H = this.area.clientHeight;
    const block = v.block;
    if (W <= 0 || H <= 0) return;
    const vw = this.root.clientWidth;
    const vh = this.root.clientHeight;
    const minPx = s.sizeMin ? sizeToPx(s.sizeMin, vw, vh) : 0;
    const maxPx = s.sizeMax ? sizeToPx(s.sizeMax, vw, vh) : Infinity;
    const mode = this.fitMode();
    // On a wall the text is laid out across every screen, so its size is
    // chosen to fit the whole wall and not just this slice of it. Each screen
    // works it out the same way, so they all land on the same size.
    const wallW = this.wall ? this.wallTextW : W;
    v.el.classList.remove('bw-locked');
    block.style.padding = inkOverhang(block)
      .map((n) => `${n.toFixed(3)}em`)
      .join(' ');

    let px: number;
    if (s.size) {
      px = sizeToPx(s.size, vw, vh);
    } else {
      const fits = (size: number) => {
        block.style.fontSize = `${size}px`;
        const okW = mode === 'height' || block.scrollWidth <= wallW + 0.5;
        const okH = mode === 'width' || block.scrollHeight <= H + 0.5;
        return okW && okH;
      };
      let lo = 1;
      let hi = Math.max(8, Math.min(Number.isFinite(maxPx) ? maxPx : Infinity, mode === 'width' ? W : H * 1.2));
      if (fits(hi)) {
        lo = hi;
      } else {
        for (let i = 0; i < 18 && hi - lo > 0.5; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
      }
      px = Math.floor(lo * 2) / 2;
      // Leave room for animations that grow or move the text.
      if (s.anim === 'pulse') px *= 0.94;
      if (s.anim === 'shake' || s.anim === 'bounce') px *= 0.96;
    }
    if (px > maxPx) px = maxPx;
    if (px < minPx) {
      px = minPx;
      if (!s.size && mode === 'both') v.el.classList.add('bw-locked');
    }
    block.style.fontSize = `${Math.max(1, px)}px`;
    if (mode !== 'both') this.setMarquee(v, W, H);
    this.applyRate();
  }

  private setMarquee(v: SlideView, W: number, H: number): void {
    const b = v.block;
    if (this.fitMode() === 'height') {
      const bw = b.scrollWidth;
      if (this.wall) {
        // The text crosses the whole wall, not just this screen.
        const m = wallMarquee(this.box.clientWidth, this.perScreenW, bw, this.wall.total);
        b.style.setProperty('--bw-from', `${m.from.toFixed(2)}px`);
        b.style.setProperty('--bw-to', `${m.to.toFixed(2)}px`);
        b.style.setProperty('--bw-dur', `${m.seconds}s`);
        return;
      }
      b.style.setProperty('--bw-from', `${W}px`);
      b.style.setProperty('--bw-to', `${-bw}px`);
      b.style.setProperty('--bw-dur', `${((W + bw) / Math.max(W, 1)) * 6}s`);
    } else {
      const bh = b.scrollHeight;
      b.style.setProperty('--bw-from', `${H}px`);
      b.style.setProperty('--bw-to', `${-bh}px`);
      b.style.setProperty('--bw-dur', `${((H + bh) / Math.max(H, 1)) * 8}s`);
    }
  }

  // ---------------------------------------------------------------- animations

  private startAnim(v: SlideView): void {
    v.stopAnim?.();
    v.stopAnim = undefined;
    v.wallResync = undefined;
    const anim = this.s!.anim;
    if (anim === 'typewriter') {
      // On a wall, join the typing where the other screens have got to and
      // keep reading the shared clock, so no screen can drift out of step.
      const elapsed = this.wall ? wallElapsed() : null;
      const tw = typewriter(
        v.block,
        () => this.rate(),
        elapsed === null ? 0 : elapsed * this.rate(),
        elapsed === null ? null : () => (wallElapsed() ?? elapsed) * this.rate(),
      );
      v.stopAnim = tw.stop;
      v.wallResync = tw.resync;
    } else if (anim !== 'none' && anim !== 'draw') {
      // Restart CSS animations when a slide is shown. The draw is driven by
      // its own clock instead (startDraw), so it has no CSS animation.
      const cls = `bw-anim-${anim}`;
      v.block.classList.remove(cls);
      void v.block.offsetWidth;
      v.block.classList.add(cls);
    }
    this.applyRate();
  }

  /**
   * Put this screen's motion at the same point in its cycle as every other
   * screen on the wall. Each screen was handed the same message at almost the
   * same moment, so counting from that moment keeps them in step without
   * their clocks having to agree. Only the phase is shared: the speed stays
   * whatever the display was given.
   */
  private updateWallAnimation(): void {
    const s = this.s;
    if (!s || !this.wall || this.destroyed) return;
    const elapsed = wallElapsed();
    if (elapsed === null) return;
    const rate = this.rate();
    // The typewriter is driven by timers, not by a CSS animation, so it has
    // to be told where the wall is by hand.
    for (const v of this.views) v.wallResync?.(elapsed * rate);
    if (!WALL_SYNCED.has(s.anim)) return;
    for (const v of this.views) {
      const b = v.block;
      if (typeof b.getAnimations !== 'function') continue;
      for (const anim of b.getAnimations()) {
        const duration = Number(anim.effect?.getComputedTiming?.().duration);
        if (!Number.isFinite(duration) || duration <= 0) continue;
        const seconds = duration / 1000;
        // The motion runs at `rate` times normal speed, so that is how far it
        // has got by now.
        const phase = (((elapsed * rate) % seconds) + seconds) % seconds;
        try {
          anim.currentTime = phase * 1000;
        } catch {
          // A browser that refuses to seek a CSS animation keeps its own phase.
        }
      }
    }
  }

  /** 1 is normal. A saved pace wins; otherwise the named speed sets the rate. */
  private rate(): number {
    const s = this.s;
    if (!s) return 1;
    if (s.pace != null && s.pace > 0) return s.pace;
    return 1 / SPEED_FACTOR[s.speed];
  }

  private applyRate(): void {
    if (!this.s || this.destroyed) return;
    const rate = this.rate();
    const apply = () => {
      if (this.destroyed) return;
      for (const v of this.views) {
        if (typeof v.block.getAnimations !== 'function') continue;
        for (const anim of v.block.getAnimations()) anim.playbackRate = rate;
      }
      this.updateWallAnimation();
    };
    apply();
    cancelAnimationFrame(this.rateFrame);
    this.rateFrame = requestAnimationFrame(apply);
  }
}

/**
 * Typewriter: reveal characters one by one, pause, delete letter by letter
 * quickly, then restart. Characters are hidden (not removed) so the layout and
 * the fitted size stay stable.
 */
function typewriter(
  block: HTMLElement,
  rateOf: () => number,
  startElapsed = 0,
  wallClock: (() => number) | null = null,
): { stop: () => void; resync: (elapsed: number) => void } {
  // Split text spans into per-character spans once.
  if (!block.dataset.tw) {
    block.dataset.tw = '1';
    block.querySelectorAll<HTMLElement>('.bw-line > span').forEach((span) => {
      if (span.classList.contains('bw-cd')) {
        span.classList.add('bw-ch');
        return;
      }
      const text = span.textContent ?? '';
      span.textContent = '';
      for (const ch of Array.from(text)) {
        const c = el('span', 'bw-ch');
        c.textContent = ch;
        span.append(c);
      }
    });
  }
  const chars = Array.from(block.querySelectorAll<HTMLElement>('.bw-ch'));
  const wait = (ms: number) => ms / Math.max(rateOf(), PACE_MIN);
  let timer = 0;
  let shown = 0;
  let phase: 'type' | 'pause' | 'delete' | 'gap' = 'type';
  // Each character takes 90ms to appear and 30ms to vanish, so how far the
  // typing has got is a function of the time since the wall started. Screens
  // on one wall were all told the same moment, so they type in step.
  const phaseFor = (elapsed: number): { phase: typeof phase; count: number; remain: number } => {
    const typed = chars.length * 90;
    const held = typed + 2200;
    const erased = held + chars.length * 30;
    const cycle = erased + 500;
    const ms = ((elapsed * 1000) % cycle + cycle) % cycle;
    if (ms < typed) {
      const count = Math.floor(ms / 90);
      return { phase: 'type', count, remain: (count + 1) * 90 - ms };
    }
    if (ms < held) return { phase: 'pause', count: chars.length, remain: held - ms };
    if (ms < erased) {
      // The first character is already gone at the instant the hold ends.
      const count = Math.max(0, chars.length - 1 - Math.floor((ms - held) / 30));
      return { phase: 'delete', count, remain: 30 - ((ms - held) % 30) };
    }
    return { phase: 'gap', count: 0, remain: cycle - ms };
  };
  chars.forEach((c) => c.classList.add('bw-hidden'));
  // Safari repaints only around the character that changed, so glyph ink that
  // reaches past that area (Caveat's "!" and "f") was left cut off. Flipping a
  // practically invisible background on the whole block makes every step
  // repaint all of it, including the ring around it that covers overhangs.
  block.classList.add('bw-tw');
  let flip = false;
  const repaint = () => {
    flip = !flip;
    block.classList.toggle('bw-tw-flip', flip);
  };
  // Code spans: the box is drawn per character while typing, with rounded
  // caps on the first character and on the last visible one, so it grows and
  // shrinks with the text instead of showing empty.
  const codeOf = chars.map((c) => c.closest<HTMLElement>('.bw-code'));
  const updateCodeEnd = (i: number) => {
    const code = codeOf[i];
    if (!code) return;
    code.querySelector('.bw-code-end')?.classList.remove('bw-code-end');
    let last = -1;
    for (let j = 0; j < shown; j++) if (codeOf[j] === code) last = j;
    if (last !== -1) chars[last].classList.add('bw-code-end');
  };
  for (const code of new Set(codeOf)) {
    code?.querySelector('.bw-ch')?.classList.add('bw-code-start');
  }
  const step = () => {
    switch (phase) {
      case 'type':
        if (shown < chars.length) {
          chars[shown++].classList.remove('bw-hidden');
          updateCodeEnd(shown - 1);
          repaint();
          timer = window.setTimeout(step, wait(90));
        } else {
          phase = 'pause';
          timer = window.setTimeout(step, wait(2200));
        }
        return;
      case 'pause':
        phase = 'delete';
        step();
        return;
      case 'delete':
        if (shown > 0) {
          chars[--shown].classList.add('bw-hidden');
          updateCodeEnd(shown);
          repaint();
          timer = window.setTimeout(step, wait(30));
        } else {
          phase = 'gap';
          timer = window.setTimeout(step, wait(500));
        }
        return;
      case 'gap':
        phase = 'type';
        step();
    }
  };
  // Put the typing at the point `elapsed` says it should be at.
  const applyAt = (at: { phase: typeof phase; count: number }): void => {
    const next = Math.min(chars.length, Math.max(0, at.count));
    if (next === shown && at.phase === phase) return;
    phase = at.phase;
    shown = next;
    chars.forEach((c, i) => c.classList.toggle('bw-hidden', i >= shown));
    block.querySelectorAll('.bw-code-end').forEach((e) => e.classList.remove('bw-code-end'));
    updateCodeEnd(shown - 1);
    repaint();
  };
  // On a wall the typing is read off the shared clock at every step, so a
  // screen cannot fall behind the others: when a character appears is a
  // function of the wall's elapsed time, not of how many steps this screen
  // has run. Off a wall the plain timer chain below drives it.
  const follow = () => {
    const at = phaseFor(wallClock!());
    applyAt(at);
    timer = window.setTimeout(follow, Math.max(wait(at.remain), 16));
  };
  if (wallClock) {
    const at = phaseFor(wallClock());
    applyAt(at);
    timer = window.setTimeout(follow, Math.max(wait(at.remain), 16));
  } else {
    timer = window.setTimeout(step, wait(90));
    // Join a wall that is already running.
    if (startElapsed > 0) applyAt(phaseFor(startElapsed));
  }
  return {
    stop: () => {
      clearTimeout(timer);
      chars.forEach((c) => c.classList.remove('bw-hidden', 'bw-code-start', 'bw-code-end'));
      block.classList.remove('bw-tw', 'bw-tw-flip');
    },
    resync: (elapsed: number) => applyAt(phaseFor(elapsed)),
  };
}
