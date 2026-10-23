// The landing page (the site's root) as an HTML string. The build prerenders
// it into index.html, so the page reads without JavaScript, and landing.ts
// renders the same markup at runtime before attaching the live pieces. No DOM
// access here: the build runs this in Node.
//
// Every class is lp-prefixed and every rule in landing.css is scoped under
// .lp: the portable build concatenates all page styles into one file, and the
// landing must not leak into (or inherit from) the app pages.

import { sitePath } from '../paths';
import { apkUrl } from '../pages';
import { qrPathData } from '../render/qr';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The link the hero demo's 「去全屏播放」 button opens. */
function playHref(text: string, bg: string, fg: string): string {
  return esc(sitePath(`/#${encodeURIComponent(text)}&bg=${bg}&fg=${fg}`));
}

/* Play links open in the same tab on purpose: a hash-only navigation stays
   in this document, so the tap's transient activation survives and the
   viewer can enter true fullscreen as it mounts. */
/** One scenario tile: a mini sign that opens fullscreen. */
function caseTile(tag: string, word: string, bg: string, fg: string, fragment: string): string {
  return (
    `<a class="lp-case lp-reveal" href="${esc(sitePath('/#' + fragment))}" style="--tbg:#${bg};--tfg:#${fg}">` +
    `<span class="lp-case-tag">${esc(tag)}</span><span class="lp-case-word lp-fit-text">${esc(word)}</span>` +
    '</a>'
  );
}

/** A ±18px QR of the site's address, as inline SVG (also used small in a card). */
function qrSvg(cls: string, fill: string, label: string): string {
  const qr = qrPathData('https://bigwords.cn');
  if (!qr) return '';
  return (
    `<svg viewBox="0 0 ${qr.size} ${qr.size}" class="${cls}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}">` +
    `<path fill="${fill}" d="${qr.d}"></path></svg>`
  );
}

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 16.6 4.7 9.3l1.4-1.4 5.9 5.9 5.9-5.9 1.4 1.4z"/></svg>';

const faqItem = (q: string, a: string) =>
  `<details><summary>${esc(q)}${CHEVRON}</summary><p>${a}</p></details>`;

const TICKER: [string, string, string][] = [
  ['接机牌', '#111111', '#ffd60a'],
  ['ON AIR', '#b00020', '#ffffff'],
  ['Wi-Fi&nbsp;Cafe2024', '#f6f3ea', '#16181d'],
  ['考试中', '#ffffff', '#111111'],
  ['生日快乐', '#f9d5e5', '#4a2c40'],
  ['请勿打扰', '#111111', '#ff5c5c'],
  ['Gate 12', '#0b3d91', '#ffffff'],
  ['今日特价', '#0a0f0a', '#3ddc84'],
  ['欢迎回家', '#111111', '#ffffff'],
  ['会议室 204', '#1f222a', '#ffd60a'],
  ['距开场 05:00', '#111111', '#ffd60a'],
  ['最后 3 天', '#f6f3ea', '#b00020'],
];

/**
 * The landing page's full markup, from nav to footer. `version` shows in the
 * footer and builds the APK link (the same repo-root VERSION the build bakes
 * into the client bundle).
 */
export function landingMarkup(version: string): string {
  const app = esc(sitePath('/app'));
  const apk = esc(apkUrl(version));
  const chips = TICKER.map(([t, bg, fg]) => `<span class="lp-chip" style="--cbg:${bg};--cfg:${fg}">${t}</span>`).join('');
  const tick = `<div class="lp-ticker" aria-hidden="true"><div class="lp-ticker-track" id="lpTickerTrack">${chips}</div></div>`;
  const card = (cls: string, demo: string, title: string, body: string) =>
    `<article class="lp-card ${cls} lp-reveal">${demo}<h3>${title}</h3><p>${body}</p></article>`;

  return (
    '<div class="lp">' +
    // ---------- 导航 ----------
    '<header class="lp-nav" id="lpNav"><div class="lp-wrap lp-nav-inner">' +
    `<a class="lp-brand" href="#top" aria-label="大字屏 BIGWORDS">` +
    '<span class="lp-brand-glyph" aria-hidden="true">大</span>' +
    '<span class="lp-brand-name">大字屏<span class="lp-brand-en">BIGWORDS</span></span></a>' +
    '<nav class="lp-nav-links" aria-label="页面导航">' +
    '<a href="#features">功能</a><a href="#cases">场景</a><a href="#download">下载</a><a href="#faq">常见问题</a>' +
    `</nav><a class="lp-btn lp-btn-primary lp-btn-sm" href="${app}" >立即使用</a>` +
    '</div></header>' +
    `<main id="top">` +
    // ---------- 首屏 ----------
    '<section class="lp-hero">' +
    '<div class="lp-glow lp-glow-a" aria-hidden="true"></div>' +
    '<div class="lp-wrap lp-hero-grid"><div class="lp-hero-copy">' +
    '<p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>免费 · 开源 · 无需注册</p>' +
    '<h1 class="lp-hero-title">把一句话，<br>铺满<em>整块屏幕</em>。</h1>' +
    '<p class="lp-lede">在手机、平板、电视或任何带浏览器的屏幕上，把想说的话放大到占满整屏。接机、倒计时、店铺 Wi-Fi、演出应援——写完即播，一条链接就是全部。</p>' +
    `<div class="lp-hero-actions"><a class="lp-btn lp-btn-primary lp-btn-lg" href="${app}">立即写一个</a>` +
    `<a class="lp-btn lp-btn-ghost lp-btn-lg" href="${apk}">` +
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17.5 10c-.6-3.1-3.2-5.5-6.5-5.5-2.6 0-4.9 1.5-6 3.7C2.6 8.5 1 10.3 1 12.5 1 15 3 17 5.5 17h11c2.2 0 4-1.8 4-4 0-1.6-1.2-3-3-3.5zM13 13v3h-2v-3H8l4-4.5 4 4.5h-3z"/></svg>' +
    '下载 Android 版</a></div>' +
    '<ul class="lp-hero-meta"><li>不装 App 也能用</li><li>内容不上传服务器</li><li>MIT 开源</li></ul>' +
    '</div>' +
    // 可交互演示
    '<div class="lp-hero-demo" aria-label="试玩演示">' +
    '<div class="lp-demo-label"><span class="lp-demo-dot" aria-hidden="true"></span>试一试：输入文字，选个配色</div>' +
    '<div class="lp-demo-screen lp-fit-box" id="lpDemoScreen"><span class="lp-fit-text" id="lpDemoText">欢迎回家</span></div>' +
    '<div class="lp-demo-controls">' +
    '<input id="lpDemoInput" class="lp-demo-input" type="text" maxlength="24" value="欢迎回家" autocomplete="off" enterkeyhint="go" aria-label="输入要显示的大字">' +
    '<div class="lp-demo-swatches" role="radiogroup" aria-label="配色方案" id="lpDemoSwatches"></div>' +
    `<a class="lp-demo-play" id="lpDemoPlay" href="${playHref('欢迎回家', '111111', 'ffd60a')}">去全屏播放` +
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></a>' +
    '</div></div>' +
    '</div></section>' +
    tick +
    // ---------- 功能 ----------
    '<section class="lp-section" id="features"><div class="lp-wrap">' +
    '<header class="lp-section-head lp-reveal">' +
    '<p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>功能</p>' +
    '<h2>为「一眼看清」而生</h2>' +
    '<p class="lp-section-lede">没有账号体系，没有复杂设置。每一项能力都直接服务于一件事：让一块普通屏幕，立刻变成一块醒目的牌子。</p></header>' +
    '<div class="lp-bento">' +
    card(
      'lp-card-a',
      '<div class="lp-card-demo lp-stage" aria-hidden="true">' +
        '<div class="lp-stage-phone lp-fit-box"><span class="lp-fit-text">早</span></div>' +
        '<div class="lp-stage-arrow"><svg viewBox="0 0 48 12" width="48" height="12"><path d="M0 6h40m0 0-6-5m6 5-6 5" stroke="#313540" stroke-width="1.5" fill="none"/></svg></div>' +
        '<div class="lp-stage-screens"><div class="lp-stage-screen lp-fit-box"><span class="lp-fit-text">早</span></div>' +
        '<div class="lp-stage-screen lp-fit-box"><span class="lp-fit-text">早</span></div>' +
        '<div class="lp-stage-screen lp-fit-box"><span class="lp-fit-text">早</span></div></div>' +
        '</div>',
      '一部手机，遥控一整面墙',
      '播放端扫码或输入编号加入房间，控制端改一个字，所有屏幕同时换。演唱会应援、店铺多屏、展厅导览，一块控多块。',
    ) +
    card(
      'lp-card-b',
      '<div class="lp-card-demo lp-card-demo-fit lp-fit-box" aria-hidden="true"><span class="lp-fit-text">大</span></div>',
      '自动铺满，永远刚好',
      '文字自动放大到占满屏幕又不溢出。手机竖屏、电视横屏、异形屏，一个字和一百个字都各得其所。',
    ) +
    card(
      'lp-card-c',
      '<div class="lp-card-demo lp-card-demo-count" aria-hidden="true"><span class="lp-count-label">NEXT HOUR</span><span class="lp-count" id="lpLiveCount">00:00:00</span></div>',
      '活的倒计时',
      '把 <code class="lp-code">{countdown}</code> 写进文字里，用 <code class="lp-code">&amp;until=</code> 定终点、<code class="lp-code">&amp;timer=</code> 定时长，到点切换成你写的结束语。',
    ) +
    card(
      'lp-card-d',
      '<div class="lp-card-demo lp-card-demo-slides" aria-hidden="true"><span class="lp-slide" id="lpLiveSlide">第一页</span></div>',
      '一条链接，多页轮播',
      '用 <code class="lp-code">||</code> 把内容分成多页，自动按时轮播。<code class="lp-code">&amp;interval=</code> 控制节奏，菜牌和议程刚好够用。',
    ) +
    card(
      'lp-card-e',
      `<div class="lp-card-demo lp-card-demo-qr" aria-hidden="true">${qrSvg('lp-qr-mini', 'currentColor', '二维码')}</div>`,
      '二维码随文字一起画',
      'Wi-Fi 密码、链接、电话、名片，在浏览器里本地生成，拼在大字下方。扫码就连网，不经过任何第三方服务。',
    ) +
    card(
      'lp-card-f',
      '<div class="lp-card-demo lp-card-demo-anim" aria-hidden="true"><span class="lp-rainbow" id="lpLiveRainbow">动起来</span></div>',
      '六款字体，一套动效',
      'Bebas、Caveat 手写、JetBrains Mono……彩虹、脉冲、滚动、闪烁，牌子该有的样子都有。',
    ) +
    card(
      'lp-card-g',
      '<div class="lp-card-demo lp-card-demo-url" aria-hidden="true"><code class="lp-url-anatomy">bigwords.cn<span class="lp-url-frag">#欢迎回家&amp;bg=111111</span></code></div>',
      '链接即全部',
      '文字和样式都收在 <code class="lp-code">#</code> 后面——这部分浏览器不会发给任何服务器。没有数据库，没有账号，关掉页面就什么都没留下。',
    ) +
    '</div></div></section>' +
    // ---------- 三步 ----------
    '<section class="lp-section lp-section-alt" id="how"><div class="lp-wrap">' +
    '<header class="lp-section-head lp-reveal"><p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>三步</p><h2>从想到，到看到</h2></header>' +
    '<ol class="lp-steps">' +
    '<li class="lp-step lp-reveal"><span class="lp-step-no" aria-hidden="true">01</span><h3>写</h3><p>打开网页，把话打进去。加粗、换行、分页，边写边看效果。</p></li>' +
    '<li class="lp-step lp-reveal"><span class="lp-step-no" aria-hidden="true">02</span><h3>链</h3><p>挑字体、调颜色，样式全部收进一条 URL。复制，或直接生成二维码。</p></li>' +
    '<li class="lp-step lp-reveal"><span class="lp-step-no" aria-hidden="true">03</span><h3>播</h3><p>把链接发给任何设备：手机、平板、电视、投影，浏览器打开即全屏。</p></li>' +
    '</ol>' +
    '<p class="lp-steps-note lp-reveal">不装 App 也完全可用——一切都在浏览器里。</p>' +
    '</div></section>' +
    // ---------- 场景 ----------
    '<section class="lp-section" id="cases"><div class="lp-wrap">' +
    '<header class="lp-section-head lp-reveal">' +
    '<p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>场景</p>' +
    '<h2>哪里都用得上</h2>' +
    '<p class="lp-section-lede">每一块都是能点开的真实链接——点进去，就是全屏的它。</p></header>' +
    '<div class="lp-cases">' +
    caseTile('接机', '接我 ♥', '111111', 'ffd60a', `${encodeURIComponent('接我 ♥')}&bg=111111&fg=ffd60a`) +
    caseTile('店铺', 'Wi-Fi\nCafe2024', 'f6f3ea', '16181d', `Wi-Fi%3A%20Cafe%20Guest%0A${encodeURIComponent('密码')}%20latte%3Bart&bg=f6f3ea&fg=16181d`) +
    caseTile('考场', '考试中\n请勿打扰', 'ffffff', '111111', `${encodeURIComponent('考试中\n请勿打扰')}&bg=ffffff&fg=111111`) +
    caseTile('直播', 'ON AIR', 'b00020', 'ffffff', `ON%20AIR&bg=b00020&fg=ffffff&anim=pulse`) +
    caseTile('应援', '他的名字', 'f9d5e5', '4a2c40', `${encodeURIComponent('他的名字')}&bg=f9d5e5&fg=4a2c40`) +
    caseTile('会议', '204\n会议室', '0b3d91', 'ffffff', `204%0A${encodeURIComponent('会议室')}&bg=0b3d91&fg=ffffff`) +
    caseTile('演出', '距开场\n05:00', '111111', 'ffd60a', `${encodeURIComponent('距开场\n{countdown}')}&timer=25m&${encodeURIComponent('zero')}=${encodeURIComponent('开始入场')}&bg=111111&fg=ffd60a`) +
    caseTile('前台', '拿铁 9 折', '0a0f0a', '3ddc84', `${encodeURIComponent('拿铁 9 折')}&bg=0a0f0a&fg=3ddc84`) +
    '</div></div></section>' +
    // ---------- 下载 ----------
    '<section class="lp-section lp-section-alt" id="download"><div class="lp-wrap">' +
    '<div class="lp-download lp-reveal">' +
    '<span class="lp-download-back" aria-hidden="true">BIGWORDS</span>' +
    '<div class="lp-download-copy">' +
    '<p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>带走它</p>' +
    '<h2>装进口袋，<br>或钉在墙上</h2>' +
    '<p class="lp-download-lede">网页版即开即用，链接收藏起来就是工具；Android 版一键安装、自动更新，旧手机往墙上一贴，就是一块常驻的屏。</p>' +
    `<div class="lp-download-actions"><a class="lp-btn lp-btn-primary lp-btn-lg" href="${app}">打开网页版</a>` +
    `<a class="lp-btn lp-btn-ghost lp-btn-lg" href="${apk}">下载 Android APK</a></div>` +
    '<p class="lp-download-note">网页版永久免费 · APK 直装，支持应用内自动更新</p>' +
    '</div>' +
    `<div class="lp-download-qr"><div class="lp-qr-box">${qrSvg('lp-qr-svg', '#0d0e11', '二维码：bigwords.cn')}</div>` +
    '<p class="lp-qr-caption">手机扫码，直接开写</p></div>' +
    '</div></div></section>' +
    // ---------- 常见问题 ----------
    '<section class="lp-section" id="faq"><div class="lp-wrap lp-wrap-narrow">' +
    '<header class="lp-section-head lp-reveal"><p class="lp-eyebrow"><span class="lp-eyebrow-dash" aria-hidden="true"></span>常见问题</p><h2>你可能想问</h2></header>' +
    '<div class="lp-faq lp-reveal">' +
    faqItem('真的免费吗？', '真的。网页版完全免费，没有付费墙，也没有广告。整个项目以 MIT 协议开源，你甚至可以自己部署一套。') +
    faqItem('需要注册账号吗？', '不需要。打开网页就是编辑器，没有登录框。最近写过的文字和颜色只留在你自己的浏览器里。') +
    faqItem('我写的内容会被上传吗？', '不会。文字和样式全部保存在链接 <code class="lp-code">#</code> 号之后的部分，浏览器从来不把这段发给服务器——这是 Web 的标准行为。服务器上没有数据库可以存你的内容。') +
    faqItem('电视、平板、投影仪能用吗？', '任何能开浏览器的屏幕都行。电视可以用遥控器输入链接，也可以手机打开后投屏；文字会自动放大到占满整块屏幕。') +
    faqItem('怎么同时控制好几块屏幕？', '在控制端建立一个房间，其他屏幕作为播放端扫码或输入编号加入。之后控制端改字、换色、翻页，所有屏幕同步执行。') +
    faqItem('支持哪些文字和语言？', '中文、英文、日文、emoji 都可以。内置六款字体，遇到不含的字形会自动落到系统字体，不会出现方块。') +
    '</div></div></section>' +
    // ---------- 结尾 CTA ----------
    '<section class="lp-cta"><span class="lp-cta-back" aria-hidden="true">大</span><div class="lp-wrap">' +
    '<h2 class="lp-reveal">就把字<em>放大</em>了看</h2>' +
    `<div class="lp-cta-actions lp-reveal"><a class="lp-btn lp-btn-primary lp-btn-lg" href="${app}">免费开始，无需注册</a>` +
    '<a class="lp-cta-gh" href="https://github.com/mdview2026/bigwords" target="_blank" rel="noopener">' +
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
    'GitHub</a></div>' +
    '</div></section>' +
    '</main>' +
    // ---------- 页脚 ----------
    '<footer class="lp-footer"><div class="lp-wrap">' +
    '<div class="lp-footer-grid">' +
    '<div class="lp-footer-brand"><a class="lp-brand" href="#top">' +
    '<span class="lp-brand-glyph" aria-hidden="true">大</span><span class="lp-brand-name">大字屏<span class="lp-brand-en">BIGWORDS</span></span></a>' +
    '<p>把任何屏幕变成一块醒目的牌子。文字与样式只存在于链接里——我们不保存任何数据。</p></div>' +
    `<nav class="lp-footer-col" aria-label="产品"><h4>产品</h4><a href="${app}">写大字</a><a href="${esc(sitePath('/docs'))}">文档</a><a href="${apk}">Android 版</a></nav>` +
    '<nav class="lp-footer-col" aria-label="项目"><h4>项目</h4>' +
    '<a href="https://github.com/mdview2026/bigwords" target="_blank" rel="noopener">GitHub</a>' +
    '<a href="https://github.com/mdview2026/bigwords/blob/main/LICENSE" target="_blank" rel="noopener">MIT 许可</a>' +
    '<a href="https://github.com/mdview2026/bigwords#self-hosting" target="_blank" rel="noopener">自部署指南</a></nav>' +
    '</div>' +
    `<div class="lp-footer-bottom"><p>© 2026 大字屏 BIGWORDS · v${esc(version)}</p><p>MIT 开源 · 内置字体各自遵循其开源许可</p></div>` +
    '</div></footer>' +
    '</div>'
  );
}
