import { serializeFragment } from '../state/fragment';
import { PARAM_ORDER, pruneDefaults } from '../state/params';

/** A look the ordinary user can pick. Style only — never shown as URL parameters. */
export interface Effect {
  id: string;
  name: string;
  /** Plain text placed in the box. Line breaks are real newlines. */
  sample: string;
  /** Draw the whole message bold, without putting markers in the text box. */
  bold?: boolean;
  /** Draw the first line as a heading. */
  heading?: boolean;
  params: Record<string, string>;
}

export const EFFECTS: readonly Effect[] = [
  { id: 'poster', name: '黄海报', sample: '说大一点', bold: true, params: { bg: '111111', fg: 'ffd60a', font: '4' } },
  { id: 'onair', name: '直播中', sample: '直播中', bold: true, params: { bg: 'b00020', fg: 'ffffff', font: '4', anim: 'pulse' } },
  { id: 'rainbow', name: '彩虹', sample: '生日快乐', params: { font: '6', anim: 'rainbow' } },
  { id: 'sign', name: '指示牌', sample: '12 号门\n请从这里进', heading: true, params: { bg: '0b3d91', fg: 'ffffff', font: '2' } },
  { id: 'welcome', name: '欢迎', sample: '欢迎回家', params: { bg: 'f9d5e5', fg: '4a2c40', font: '6', anim: 'pulse' } },
  { id: 'ticker', name: '滚动字幕', sample: '这条消息会一直滚过去', params: { bg: '000000', fg: '00ff66', font: '4', anim: 'scroll' } },
  { id: 'type', name: '打字机', sample: '正在输入', params: { bg: '101010', fg: 'f5f5f0', font: '5', anim: 'typewriter' } },
  { id: 'bounce', name: '弹一下', sample: '看这里', params: { bg: 'fff4e0', fg: 'c2410c', font: '6', anim: 'bounce' } },
  { id: 'quiet', name: '请安静', sample: '请安静\n正在录制', bold: true, params: { bg: '111111', fg: 'ff5c5c', font: '1' } },
  { id: 'flash', name: '闪一下', sample: '特价', bold: true, params: { bg: 'ffd60a', fg: '111111', font: '4', anim: 'flash' } },
  { id: 'chalk', name: '黑板', sample: '今天学这个', params: { bg: '16382b', fg: 'e8f5c8', font: '6' } },
  { id: 'paper', name: '白纸黑字', sample: '会议进行中', bold: true, params: { bg: 'ffffff', fg: '151515', font: '1' } },
  { id: 'shake', name: '抖一下', sample: '注意', bold: true, params: { bg: '111111', fg: 'ffffff', font: '2', anim: 'shake' } },
  { id: 'night', name: '夜色', sample: '晚上好', params: { bg: '1b1430', fg: 'f3e8ff', font: '3', anim: 'fadein', speed: 'slow' } },
  { id: 'credits', name: '谢幕', sample: '谢谢观看\n下次再见', params: { bg: '111111', fg: 'ffffff', font: '3', anim: 'crawl' } },
];

const byId = new Map(EFFECTS.map((effect) => [effect.id, effect]));

export function effectById(id: string): Effect | undefined {
  return byId.get(id);
}

/** Text the screen shows. Markers stay out of the text box. */
export function presentMessage(effect: Effect, text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => {
      if (effect.heading && index === 0 && line.trim() && !line.trimStart().startsWith('#')) return `# ${line.trim()}`;
      if (effect.bold && line.trim() && !line.includes('*')) return `**${line}**`;
      return line;
    })
    .join('\n');
}

/** The color an effect starts with, as 6-digit hex without '#'. */
export function effectHex(effect: Effect, key: 'bg' | 'fg', light: boolean): string {
  const raw = effect.params[key]?.trim().toLowerCase() ?? '';
  if (/^[0-9a-f]{6}$/.test(raw)) return raw;
  if (key === 'bg') return light ? 'ffffff' : '000000';
  return light ? '000000' : 'ffffff';
}

/**
 * Viewer fragment for this effect, the user's words, and an optional size.
 * `sizeVh` is a percent of the screen height. Null keeps the automatic fit.
 * A chosen size replaces any size cap baked into the effect.
 * Pass `fg` or `bg` only when the person picked a color different from the effect.
 * `pace` is the playback rate (1 is normal) remembered from the last showing.
 */
export function effectFragment(
  effect: Effect,
  text: string,
  sizeVh: number | null,
  colors?: { fg?: string | null; bg?: string | null; pace?: number | null },
): string {
  const params = { ...effect.params };
  const hex = (value: string | null | undefined) => {
    const raw = value?.replace(/^#/, '').trim().toLowerCase() ?? '';
    return /^[0-9a-f]{6}$/.test(raw) ? raw : null;
  };
  const fg = hex(colors?.fg);
  const bg = hex(colors?.bg);
  if (fg) params.fg = fg;
  if (bg) params.bg = bg;
  const pace = colors?.pace;
  if (typeof pace === 'number' && Number.isFinite(pace) && pace > 0) {
    params.pace = String(Math.round(Math.min(4, Math.max(0.25, pace)) * 100) / 100);
  }
  if (sizeVh != null && Number.isFinite(sizeVh) && sizeVh > 0) {
    params.size = `${Math.round(sizeVh * 10) / 10}vh`;
    delete params['size-max'];
    delete params['size-min'];
  }
  return serializeFragment({ message: presentMessage(effect, text), params: pruneDefaults(params) }, PARAM_ORDER);
}
