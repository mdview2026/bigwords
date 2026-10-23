// Reproduce: controller stop -> play again leaves the player black.
// Usage: node scripts/repro-resume.mjs [baseUrl]  (needs vite preview running)
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
mkdirSync('.tmpbroker/shots', { recursive: true });
const executablePath = process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH) ? process.env.CHROMIUM_PATH : undefined;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath });
const playerCtx = await browser.newContext({ viewport: { width: 420, height: 800 } });
const controlCtx = await browser.newContext({ viewport: { width: 420, height: 800 } });
for (const [tag, ctx] of [['player', playerCtx], ['control', controlCtx]]) {
  ctx.on('console', (m) => console.log(`[${tag}]`, m.type(), m.text()));
  ctx.on('pageerror', (e) => console.log(`[${tag}] PAGEERROR`, String(e)));
}

const p = await playerCtx.newPage();
await p.goto(BASE + '/?role=player');
await p.waitForSelector('.player-id');
const id = (await p.textContent('.player-id')).trim().replace(/\s+/g, '');
console.log('player id:', id);
await p.waitForFunction(() => document.body.textContent.includes('已连接，等待控制'));

// Seed the composer draft, then open the one-screen console directly.
const c = await controlCtx.newPage();
await c.goto(BASE + '/');
await c.evaluate(() =>
  localStorage.setItem(
    'bw-quick-draft',
    JSON.stringify({ effectId: 'poster', text: '复现测试', fg: 'ffd60a', bg: '111111' }),
  ),
);
await c.goto(BASE + '/?role=control');
await c.waitForSelector('.console');
await c.fill('.console-add-row input', id);
await c.click('.console-add-btn');

// No 接受控制 tap any more: being numbered takes the player straight in.
await p.waitForFunction(() => document.body.classList.contains('page-viewer'), null, { timeout: 15000 });
console.log('player joined and entered playback');
await c.locator('.console-play-btn:not([disabled])').waitFor();

// Play 1: the screen shows the message.
await c.click('.console-play-btn');
await p.waitForFunction(() => document.querySelector('.bw-block')?.textContent === '复现测试', null, { timeout: 10000 });
await sleep(800);
console.log('after play1 hash:', await p.evaluate(() => location.hash));
await p.screenshot({ path: '.tmpbroker/shots/play1.png' });

// Stop: the screen goes black.
await c.click('.console-stop-btn');
await sleep(1200);
console.log('after stop:', await p.evaluate(() => ({ hash: location.hash, text: document.querySelector('.bw-block')?.textContent ?? null })));
await p.screenshot({ path: '.tmpbroker/shots/stop.png' });

// Play 2: the same message again.
await c.locator('.console-play-btn:not([disabled])').waitFor();
await c.click('.console-play-btn');
await p.waitForFunction(() => document.querySelector('.bw-block')?.textContent === '复现测试', null, { timeout: 10000 });
await sleep(800);
const after = await p.evaluate(() => ({
  hash: location.hash,
  text: document.querySelector('.bw-block')?.textContent ?? null,
}));
console.log('after play2:', JSON.stringify(after));
await p.screenshot({ path: '.tmpbroker/shots/play2.png' });
console.log(after.text === '复现测试' ? 'REPRO OK: screen took the second play' : 'REPRO FAIL: screen still black');

await browser.close();
