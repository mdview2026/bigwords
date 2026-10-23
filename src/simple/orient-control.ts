import { h } from '../chrome';
import { readOrient, saveOrient, type DisplayOrient } from '../orient';

/** Landscape / portrait switch. Shown on phones; hidden on a desktop layout. */
export function orientToggle(onChange?: (value: DisplayOrient) => void): HTMLElement {
  const land = h('button', { class: 'btn', type: 'button' }, '横屏') as HTMLButtonElement;
  const port = h('button', { class: 'btn', type: 'button' }, '竖屏') as HTMLButtonElement;
  const paint = (value: DisplayOrient) => {
    land.setAttribute('aria-pressed', value === 'landscape' ? 'true' : 'false');
    port.setAttribute('aria-pressed', value === 'portrait' ? 'true' : 'false');
  };
  const pick = (value: DisplayOrient) => {
    saveOrient(value);
    paint(value);
    onChange?.(value);
  };
  land.addEventListener('click', () => pick('landscape'));
  port.addEventListener('click', () => pick('portrait'));
  paint(readOrient());
  return h('div', { class: 'orient-toggle', role: 'group', 'aria-label': '播放方向' }, land, port);
}
