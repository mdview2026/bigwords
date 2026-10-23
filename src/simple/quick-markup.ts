import { EFFECTS, effectHex } from './effects';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The first screen as HTML: one composer, no steps. The build prerenders it
 * into index.html, so the page reads without JavaScript; quick.ts renders the
 * same markup at runtime and then brings it to life.
 * No DOM access here: the build runs it in Node.
 */
export function quickMarkup(version = ''): string {
  const first = EFFECTS[0];
  const chips = EFFECTS.map((effect) => {
    const fg = effectHex(effect, 'fg', false);
    const bg = effectHex(effect, 'bg', false);
    const selected = effect.id === first.id;
    return (
      `<button type="button" class="quick-effect" data-effect="${esc(effect.id)}" aria-pressed="${selected}" aria-label="${esc(effect.name)}">` +
      `<span class="quick-effect-demo" style="background:#${bg};color:#${fg}">Aa</span>` +
      `<span class="quick-effect-name">${esc(effect.name)}</span>` +
      '</button>'
    );
  }).join('');
  return (
    '<main class="quick">' +
    '<section class="quick-stage-wrap" aria-label="预览">' +
    '<div class="quick-stage is-empty" tabindex="0" aria-label="预览"></div>' +
    '<div class="quick-stage-foot">' +
    '<p class="quick-hint">点播放全屏，双击切换全屏</p>' +
    (version ? `<span class="quick-version">v${esc(version)}</span>` : '') +
    '</div></section>' +
    '<section class="quick-panel" aria-label="设置">' +
    '<div class="quick-field">' +
    '<div class="quick-field-head"><span class="quick-label">效果</span><span class="quick-effect-current">' +
    esc(first.name) +
    '</span></div>' +
    `<div class="quick-effect-rail" role="group" aria-label="选择效果">${chips}</div>` +
    '</div>' +
    '<div class="quick-field">' +
    '<label class="quick-label" for="quick-text">文字</label>' +
    '<textarea id="quick-text" class="quick-text" rows="2" enterkeyhint="done" aria-label="要展示的文字" placeholder="写上要展示的文字，回车可以换行">' +
    esc(first.sample) +
    '</textarea>' +
    '<div class="quick-history" aria-label="历史文字" hidden></div>' +
    '</div>' +
    '<div class="quick-field quick-colors">' +
    '<div class="quick-color-row">' +
    '<span class="quick-color-label">文字颜色</span>' +
    `<input type="color" class="quick-color" data-kind="fg" aria-label="文字颜色" value="#${effectHex(first, 'fg', false)}">` +
    '<div class="quick-swatches" data-kind="fg" aria-label="最近的文字颜色"></div>' +
    '</div>' +
    '<div class="quick-color-row">' +
    '<span class="quick-color-label">背景颜色</span>' +
    `<input type="color" class="quick-color" data-kind="bg" aria-label="背景颜色" value="#${effectHex(first, 'bg', false)}">` +
    '<div class="quick-swatches" data-kind="bg" aria-label="最近的背景颜色"></div>' +
    '</div></div>' +
    '<div class="quick-actions">' +
    '<button type="button" class="btn btn-primary quick-play">播放</button>' +
    '<button type="button" class="btn quick-remote" title="控制其他屏幕播放；也可以让这块屏幕作为播放端加入">控制其他屏幕</button>' +
    '</div>' +
    '<div class="quick-foot">' +
    '<p class="quick-note">文字和颜色会记在这台设备上。</p>' +
    '<button type="button" class="quick-player-link">让这块屏幕播放</button>' +
    '</div>' +
    '</section></main>'
  );
}
