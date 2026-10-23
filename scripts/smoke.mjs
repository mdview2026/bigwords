// End-to-end smoke test against a running build (npm run build && npm run preview).
// Usage: node scripts/smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = process.argv[3];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
// CHROMIUM_PATH points at a system Chromium; otherwise Playwright uses its own.
const executablePath = process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH) ? process.env.CHROMIUM_PATH : undefined;

const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Chrome logs the deliberate 404 of the not-found checks as an error.
const expected404 = (m) => /status of 404/.test(m.text()) && /\/nope(#|$)/.test(m.location().url);
page.on('console', (m) => m.type() === 'error' && !expected404(m) && errors.push(m.text()));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const settle = (ms = 400) => page.waitForTimeout(ms);

/** Returns the text block's font size and whether it overflows the text area. */
const blockInfo = () =>
  page.evaluate(() => {
    const slide = [...document.querySelectorAll('.bw-slide')].find((s) => !s.hidden);
    const block = slide?.querySelector('.bw-block');
    const area = document.querySelector('.bw-area');
    if (!block || !area) return null;
    const a = area.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    return {
      fontSize: parseFloat(block.style.fontSize),
      inside: b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1,
      text: block.textContent,
      fill: Math.max(b.width / a.width, b.height / a.height),
    };
  });

// Landing (the root without a fragment)
await page.goto(BASE + '/');
await settle();
check('landing renders', (await page.locator('.lp-hero-title').count()) === 1 && (await page.locator('.lp-card').count()) === 7);
check('landing title', (await page.title()) === '大字屏 BIGWORDS — 把一句话，铺满整块屏幕', await page.title());
check('landing case tiles link to displays', (await page.locator('.lp-case').first().getAttribute('href') ?? '').includes('#'));
const landingApk = await page.locator('.lp-download-actions a[href$=".apk"]').getAttribute('href');
check('landing APK link is versioned', /\/bigwords_\d+\.\d+\.\d+\.apk$/.test(landingApk ?? ''), landingApk ?? '');
// The demo builds a real display link as you type.
await page.locator('#lpDemoInput').fill('生日快乐');
await page.locator('.lp-swatch').nth(4).click();
const demoHref = await page.locator('#lpDemoPlay').getAttribute('href');
check('demo play link tracks input and scheme', decodeURIComponent(demoHref ?? '').includes('生日快乐') && demoHref.includes('bg=f9d5e5'), demoHref);
await shot('landing');
await page.setViewportSize({ width: 375, height: 667 });
const landingMobile = await page.evaluate(() => {
  const title = document.querySelector('.lp-hero-title');
  return !!title && title.getBoundingClientRect().top < innerHeight;
});
check('landing headline on the first phone screen', landingMobile);
await page.setViewportSize({ width: 1280, height: 720 });

// App (the composer, one click from the landing)
await page.goto(BASE + '/app');
await settle();
check('app renders the composer', (await page.locator('.quick-effect').count()) === 15);
check('composer has a live preview', (await page.locator('.quick-stage .bw-block').count()) > 0);
check('composer starts with sample words', (await page.locator('.quick-text').inputValue()) === '说大一点');
check('composer play button is ready', await page.locator('.quick-play').isEnabled());
const quickVersion = await page.locator('.quick-version').textContent();
check('composer shows the running version', /^v\d+\.\d+\.\d+$/.test(quickVersion), quickVersion);
const apkHref = await page.locator('a[data-apk]').getAttribute('href');
check('download link is versioned', /\/bigwords_\d+\.\d+\.\d+\.apk$/.test(apkHref ?? ''), apkHref ?? '');
// A phone-sized first screen still shows the version under the preview.
await page.setViewportSize({ width: 375, height: 667 });
const versionOnScreen = await page.evaluate(() => {
  const el = document.querySelector('.quick-version');
  return !!el && el.getBoundingClientRect().top < innerHeight - 1;
});
check('version on the first phone screen', versionOnScreen);
await page.setViewportSize({ width: 1280, height: 720 });
check('app title', (await page.title()) === '写大字 · 大字屏', await page.title());
await shot('home');

// Picking an effect updates the preview and, while the words are still the
// effect's sample, brings that effect's sample along.
await page.locator('.quick-effect[data-effect="rainbow"]').click();
check(
  'effect picker marks the choice',
  (await page.locator('.quick-effect[data-effect="rainbow"]').getAttribute('aria-pressed')) === 'true' &&
    (await page.locator('.quick-effect-current').textContent()) === '彩虹',
);
check('switching effect brings its sample', (await page.locator('.quick-text').inputValue()) === '生日快乐');

// A device that only wants to be a player can connect before writing anything;
// the controller half of the sheet waits for words.
await page.locator('.quick-text').fill('');
await page.locator('.quick-player-link').click();
check(
  'player entry works without words',
  (await page.locator('.quick-connect-option[data-connect="control-scan"]').isDisabled()) &&
    (await page.locator('.quick-connect-option[data-connect="player-show"]').isEnabled()),
);
check('empty words explains the control limit', await page.locator('.quick-connect-note').isVisible());
await page.locator('.quick-connect-close').click();

// Words, colors, and their histories.
await page.locator('.quick-text').fill('你好 首页');
await page.locator('.quick-text').blur();
await page.locator('.quick-color[data-kind="fg"]').evaluate((el) => {
  el.value = '#ff0000';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(100);
check('picked color appears in history', (await page.locator('.quick-swatch[data-color="ff0000"]').count()) === 1);
await page.locator('.quick-play').click();
await settle(700);
const homeSign = await blockInfo();
check('play opens the fullscreen sign', !!homeSign && homeSign.text.includes('你好 首页'), JSON.stringify(homeSign));
await page.goBack();
await settle();
check('composer returns with the last words', (await page.locator('.quick-text').inputValue()) === '你好 首页');
check('recent words are selectable', (await page.locator('.quick-history-chip').first().textContent()) === '你好 首页');
check('recent colors are selectable', (await page.locator('.quick-swatch-note').first().textContent()) === '最近');

// The remote entry hands the same sign to the controller console, so nothing
// has to be set up twice and there are no next/previous steps.
await page.locator('.quick-remote').click();
check('remote entry offers four device directions', (await page.locator('.quick-connect-option').count()) === 4);
await page.locator('.quick-connect-option[data-connect="control-scan"]').click();
await page.locator('.console').waitFor();
check(
  'remote entry opens the controller console',
  new URL(page.url()).search === '?role=control' &&
    (await page.locator('.console-card-head h2').first().textContent()) === '连接播放屏幕' &&
    (await page.locator('.console-sign').textContent()).includes('你好 首页'),
  page.url(),
);
check('console has no step-through buttons', (await page.locator('button:has-text("下一步"), button:has-text("上一步")').count()) === 0);
check('console play waits for a screen', await page.locator('.console-play-btn').isDisabled());

// Viewer: plain text fits
await page.goto(BASE + '/#Hello%20World');
await settle();
let info = await blockInfo();
check('viewer renders message', info?.text === 'Hello World', info?.text);
check('viewer title never shows the message', (await page.title()) === '大字屏', await page.title());
check('auto-fit fills and stays inside', !!info && info.inside && info.fill > 0.9, JSON.stringify(info));
await shot('viewer-hello');

// Navigating to an empty fragment returns the landing page
await page.evaluate(() => (location.hash = ''));
await settle();
check('empty fragment → landing', (await page.locator('.lp').count()) === 1);

// Solid red with no message
await page.goto(BASE + '/#&bg=ff0000');
await settle();
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.bw-box')).backgroundColor);
check('#&bg=ff0000 is red', bg === 'rgb(255, 0, 0)', bg);

// Markdown + headings
await page.goto(BASE + '/#%23%20Title%0A**bold**%20and%20*it*%20\\*lit\\*');
await settle();
check('heading line', (await page.locator('.bw-h1').textContent()) === 'Title');
check('bold & italic', (await page.locator('.bw-b').first().textContent()) === 'bold' && (await page.locator('.bw-i').first().textContent()) === 'it');
info = await blockInfo();
check('escaped stars literal', info?.text.includes('*lit*'), info?.text);

// Multi-line fit at different sizes and ratios
for (const [w, hgt] of [[375, 667], [1920, 1080], [800, 800]]) {
  await page.setViewportSize({ width: w, height: hgt });
  await page.goto(BASE + '/#A%20much%20longer%20message%20that%20must%20wrap%20onto%20several%20lines%0Aand%20keep%20breaks&ratio=4:3&font=1');
  await settle(700);
  info = await blockInfo();
  check(`fit ${w}x${hgt} ratio 4:3`, !!info && info.inside && info.fill > 0.85, JSON.stringify(info));
  const box = await page.evaluate(() => {
    const r = document.querySelector('.bw-box').getBoundingClientRect();
    return r.width / r.height;
  });
  check(`ratio box ${w}x${hgt}`, Math.abs(box - 4 / 3) < 0.02, String(box));
}
await shot('viewer-ratio');
await page.setViewportSize({ width: 1280, height: 720 });

// size-max and size-min
await page.goto(BASE + '/#Hi&size-max=50');
await settle();
info = await blockInfo();
check('size-max caps', info?.fontSize === 50, String(info?.fontSize));
await page.goto(BASE + '/#' + 'word%20'.repeat(400) + '&size-min=40');
await settle();
const locked = await page.evaluate(() => document.querySelector('.bw-slide.bw-locked') !== null);
info = await blockInfo();
check('size-min locks and scrolls', locked && info?.fontSize === 40, String(info?.fontSize));

// Slides rotate
await page.goto(BASE + '/#One||Two||Three&interval=1');
await settle(300);
const first = (await blockInfo())?.text;
await page.waitForTimeout(1500);
const second = (await blockInfo())?.text;
check('slides rotate', first === 'One' && second !== 'One', `${first} → ${second}`);
check('escaped || not split', await (async () => {
  await page.goto(BASE + '/#a\\||b');
  await settle();
  return (await page.locator('.bw-slide').count()) === 1 && (await blockInfo())?.text === 'a||b';
})());

// Countdown
const future = new Date(Date.now() + (2 * 86400 + 3600 * 3 + 125) * 1000);
const pad = (n) => String(n).padStart(2, '0');
const iso = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}:${pad(future.getSeconds())}`;
await page.goto(BASE + `/#Starts%20in%0A{countdown}&until=${iso}`);
await settle();
const cd = await page.locator('.bw-cd').textContent();
check('countdown label format', /^2d 03h 0[12]m \d\ds$/.test(cd), cd);
await page.goto(BASE + `/#{countdown}&until=${iso}&cdfmt=colon`);
await settle();
check('countdown colon format', /^02:03:0[12]:\d\d$/.test(await page.locator('.bw-cd').textContent()));
await page.goto(BASE + '/#{countdown}');
await settle();
check('{countdown} literal without until', (await blockInfo())?.text === '{countdown}');
await page.goto(BASE + '/#A||B%20{countdown}||C&until=2000-01-01T00:00:00&zero=hide');
await settle();
check('zero=hide drops countdown slides', (await page.locator('.bw-slide').count()) === 2);
await page.goto(BASE + '/#Wait%20{countdown}&until=2000-01-01T00:00:00&zero=Go!');
await settle();
check('zero=message replaces', (await blockInfo())?.text === 'Go!');
await page.goto(BASE + '/#Wait%20{countdown}&until=2000-01-01T00:00:00&zero=**Back%20to%0Awork!**');
await settle();
const zeroLines = await page.evaluate(() => [...document.querySelectorAll('.bw-slide:not([hidden]) .bw-line')].map((l) => l.querySelector('.bw-b')?.textContent));
check('zero message keeps line breaks and formatting', JSON.stringify(zeroLines) === '["Back to","work!"]', JSON.stringify(zeroLines));
await page.goto(BASE + '/#{countdown}&timer=4h');
await settle();
const tm = await page.locator('.bw-cd').textContent();
check('timer counts down from its length', /^(4h 00m 00s|3h 59m 5\ds)$/.test(tm), tm);
await page.goto(BASE + '/#{countdown}&timer=1h&until=2000-01-01T00:00:00&zero=Go!');
await settle();
check('first of timer and until wins', /^(1h 00m 00s|59m 5\ds)$/.test(await page.locator('.bw-cd').textContent()));
await page.goto(BASE + '/#Wait%20{countdown}&timer=2s&zero=Done!');
await page.waitForTimeout(3500);
check('timer reaches zero', (await blockInfo())?.text === 'Done!', (await blockInfo())?.text);

// QR
await page.goto(BASE + '/#Scan&qr=https://example.com/a?b=1%26c=2&qrpos=below');
await page.waitForSelector('.bw-qr svg', { timeout: 3000 }).catch(() => null);
check('QR renders', (await page.locator('.bw-qr svg path').count()) === 1);
await shot('viewer-qr');
const qrWidth = () => page.locator('.bw-qr').evaluate((e) => e.getBoundingClientRect().width);
const defaultQr = await qrWidth();
await page.goto(BASE + '/#Join&qr=WIFI:T:WPA;S:Guest;P:sunshine;;&qrsize=50');
await page.waitForSelector('.bw-qr svg', { timeout: 3000 }).catch(() => null);
check('qrsize=50 draws a code twice the default size', Math.abs((await qrWidth()) - 2 * defaultQr) <= 2, `${defaultQr} → ${await qrWidth()}`);

// Animations
for (const anim of ['pulse', 'scroll', 'crawl', 'typewriter', 'rainbow']) {
  await page.goto(BASE + `/#Animated%20text&anim=${anim}&size-max=30vh`);
  await settle(600);
  const ok = await page.evaluate((a) => {
    const block = document.querySelector('.bw-block');
    if (a === 'typewriter') return document.querySelectorAll('.bw-ch').length > 0;
    return block.getAnimations().length > 0;
  }, anim);
  check(`anim ${anim} running`, ok);
}

// Wall scroll: one pass runs wall-edge to wall-edge, so the next pass starts
// the moment the last one's tail leaves the first screen — no dead time.
// (Pause + seek the marquee; seek and rect read share one JS task, so the
// wall's 1s resync timer cannot move it in between.)
await page.goto(BASE + '/#' + encodeURIComponent('这条拼接屏滚动字幕足够长，宽度远超一块屏幕，用来检验滚动首尾的衔接。') + '&anim=scroll&wall=1/2');
await settle(700);
const marquee = await page.evaluate(() => {
  const stage = document.querySelector('.bw-stage');
  const block = document.querySelector('.bw-block');
  const anim = block?.getAnimations().find((a) => a.animationName === 'bw-marquee-x');
  if (!anim) return null;
  const s = stage.getBoundingClientRect();
  const dur = anim.effect.getComputedTiming().duration;
  anim.pause();
  const at = (ms) => {
    anim.currentTime = ms;
    const b = block.getBoundingClientRect();
    return { left: b.left - s.left, right: b.right - s.left };
  };
  const start = at(0);
  const end = at(dur - 1);
  // Slot 1 of 2 holds the wall's left half: its stage left edge is the wall's
  // left edge, and the wall's right edge is one screen further right.
  return {
    stageW: s.right - s.left,
    blockW: start.right - start.left,
    enterGap: 2 * s.width - start.left, // px the head starts beyond the wall's right edge
    exitGap: end.right, // px the tail is still inside the wall's left edge at the end
  };
});
check(
  'wall marquee loops without dead time',
  !!marquee &&
    marquee.blockW > marquee.stageW * 1.5 && // text wider than a screen, so the check bites
    Math.abs(marquee.enterGap) < 2 &&
    Math.abs(marquee.exitGap) < 2,
  JSON.stringify(marquee),
);

// Lucky draw: the chip flies across the wall's shared clock, in the band
// under the screen's own number. The landing itself is pinned by unit tests;
// here the chip must exist, sit in the middle band and be moving.
await page.goto(BASE + '/#**2**&anim=draw&draw=5&wall=2/3');
await settle(2500);
const draw = await page.evaluate(() => {
  const chip = document.querySelector('.bw-draw-chip');
  const stage = document.querySelector('.bw-stage');
  const block = document.querySelector('.bw-block');
  if (!chip || !stage || !block) return null;
  const s = stage.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  return {
    text: block.textContent,
    midBand: c.top >= s.top + s.height * 0.5 && c.bottom <= s.top + s.height * 0.8,
    transform: chip.style.transform,
    width: chip.getBoundingClientRect().width,
  };
});
await settle(600);
const drawLater = await page.evaluate(() => document.querySelector('.bw-draw-chip')?.style.transform);
check(
  'lucky draw chip flying under the number',
  !!draw &&
    draw.text === '2' &&
    draw.midBand &&
    draw.width > 100 &&
    !!drawLater &&
    drawLater !== draw.transform, // still moving, so the flight is alive
  JSON.stringify({ ...draw, later: drawLater }),
);

// Fonts lazy-load only when used
// Each check uses a fresh document, since registered fonts persist across fragment changes.
const fontRequests = [];
page.on('request', (r) => r.url().includes('/fonts/') && fontRequests.push(r.url()));
await page.goto('about:blank');
await page.goto(BASE + '/#Plain');
await settle();
check('no font downloads for font=0', fontRequests.length === 0, fontRequests.join(', '));
await page.goto('about:blank');
await page.goto(BASE + '/#Bebas&font=4');
await settle(800);
check('font=4 loads from own origin', fontRequests.some((u) => u.startsWith(BASE) && u.includes('bebas-neue')));

// Docs
await page.goto(BASE + '/docs');
await settle();
check('docs render', (await page.locator('.docs h2').count()) > 8);
check('docs title', (await page.title()) === 'Docs: URL reference · 大字屏', await page.title());
await shot('docs');

// SEO: per-page metadata, robots.txt, sitemap.xml. Pass the SITE_URL the
// build used; without it, the absolute-URL tags and the sitemap are left out.
const SITE = process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : '';
for (const [path, canonical] of [['/', '/'], ['/docs', '/docs'], ['/#Hello', '/']]) {
  await page.goto(BASE + path);
  const meta = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href'),
    image: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    description: document.querySelector('meta[name=description]')?.getAttribute('content'),
    titles: document.querySelectorAll('title').length,
  }));
  const urls = SITE ? meta.canonical === SITE + canonical && meta.image === `${SITE}/og.png` : meta.canonical === undefined && meta.image === undefined;
  check(`metadata ${path}`, urls && !!meta.description && meta.titles === 1, JSON.stringify(meta));
}
const jsonLd = await page.request.get(BASE + '/').then((r) => r.text()).then((html) => html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]);
check(SITE ? 'home JSON-LD parses' : 'no JSON-LD without SITE_URL', SITE ? (() => { try { return JSON.parse(jsonLd)['@graph'].length === 2; } catch { return false; } })() : jsonLd === undefined);
for (const path of ['/robots.txt', '/og.png', '/apple-touch-icon.png']) {
  check(`${path} served`, (await page.request.get(BASE + path)).ok());
}
check(SITE ? '/sitemap.xml served' : 'no sitemap without SITE_URL', (await page.request.get(BASE + '/sitemap.xml')).ok() === !!SITE);

// Unknown paths are real 404s with a noindex page; a mistyped display path
// still offers the display.
let resp = await page.goto(BASE + '/nope');
check('unknown path is 404', resp.status() === 404, String(resp.status()));
check('404 page renders', (await page.locator('main h1').textContent()) === 'Page not found' && (await page.title()) === 'Page not found · 大字屏', await page.title());
check('404 page noindex', (await page.locator('meta[name=robots]').getAttribute('content')) === 'noindex');
resp = await page.goto(BASE + '/nope#Hello%20World');
await settle();
check('404 offers the display', (await page.locator('a', { hasText: 'Open this display' }).getAttribute('href')) === '/#Hello%20World');
for (const path of ['/', '/app', '/guide', '/docs']) {
  check(`${path} is 200`, (await page.request.get(BASE + path)).status() === 200);
}
check('/editor is gone', (await page.request.get(BASE + '/editor')).status() === 404);

// The docs read without JavaScript, styled.
const noJs = await browser.newContext({ javaScriptEnabled: false });
const noJsPage = await noJs.newPage();
await noJsPage.goto(BASE + '/docs');
check('docs prerendered without JS', (await noJsPage.locator('.docs h1').count()) === 1 && (await noJsPage.locator('.docs h2').count()) > 8);
check('prerendered docs styled', (await noJsPage.evaluate(() => getComputedStyle(document.querySelector('.docs')).maxWidth)) === '860px');
await noJsPage.goto(BASE + '/nope');
check('404 page prerendered and styled', (await noJsPage.locator('.docs h1').textContent()) === 'Page not found' && (await noJsPage.evaluate(() => getComputedStyle(document.querySelector('.docs')).maxWidth)) === '860px');
const guideHtml = await page.request.get(BASE + '/guide').then((r) => r.text());
check('guide retired into a redirect', guideHtml.includes('http-equiv="refresh"') && guideHtml.includes('noindex'), guideHtml.slice(0, 120));
await noJsPage.goto(BASE + '/');
check(
  'landing prerendered without JS',
  (await noJsPage.locator('.lp-hero-title').count()) === 1 && (await noJsPage.locator('.lp-card').count()) === 7,
);
check('prerendered landing styled', (await noJsPage.evaluate(() => getComputedStyle(document.querySelector('.lp')).backgroundColor)) === 'rgb(13, 14, 17)');
check('prerendered landing APK link is versioned', /\/bigwords_\d+\.\d+\.\d+\.apk$/.test((await noJsPage.locator('.lp-download-actions a[href$=".apk"]').getAttribute('href')) ?? ''));
await noJsPage.goto(BASE + '/app');
check(
  'composer prerendered without JS',
  (await noJsPage.locator('.quick-effect').count()) === 15 &&
    (await noJsPage.locator('.quick-text').inputValue()) === '说大一点' &&
    /^v\d+\.\d+\.\d+$/.test((await noJsPage.locator('.quick-version').textContent())),
);
check('prerendered download link is versioned', /\/bigwords_\d+\.\d+\.\d+\.apk$/.test((await noJsPage.locator('a[data-apk]').getAttribute('href')) ?? ''));
check('prerendered composer styled', (await noJsPage.evaluate(() => getComputedStyle(document.querySelector('.quick')).maxWidth)) === '1280px');
await noJs.close();

// A display link must never show the prerendered home page, even before the
// app's script has loaded. Blocking the script freezes the page in that state.
// Pages get the Caddyfile's CSP, which must allow the inline guard.
const csp = readFileSync(new URL('../Caddyfile', import.meta.url), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1];
const slow = await browser.newContext();
await slow.route(/\/(src|assets)\/.*\.(js|ts)(\?.*)?$/, (route) => route.abort());
await slow.route(/\/(#.*)?$/, async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
});
const slowPage = await slow.newPage();
const cspErrors = [];
slowPage.on('console', (m) => /Content Security Policy/i.test(m.text()) && cspErrors.push(m.text()));
await slowPage.goto(BASE + '/#Hello');
check('display link hides the landing before JS', !(await slowPage.locator('.lp').isVisible()));
await slowPage.goto(BASE + '/');
check('landing shows before JS', await slowPage.locator('.lp-hero-title').isVisible());
check('CSP allows the display guard', cspErrors.length === 0, cspErrors.join(' | '));
await slow.close();

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
