// Titles and descriptions for the indexable pages. The build writes them into
// each page's static HTML (vite-plugin-docs.ts) and main.ts sets the same
// titles at runtime, so the two never disagree.

export const SITE_NAME = '大字屏';

/** The project's source code, linked from the landing page footer. */
export const SOURCE_URL = 'https://github.com/mdview2026/bigwords';

/**
 * The Android installer served by bigwords.cn (deploy-bigwords.bat uploads
 * android\dist\bigwords_<VERSION>.apk). The versioned filename is immutable,
 * so buttons and QR codes never serve a stale download the way a rolling
 * -latest alias could.
 */
export function apkUrl(version: string): string {
  return `https://bigwords.cn/download/bigwords_${encodeURIComponent(version)}.apk`;
}

export interface PageMeta {
  path: string;
  title: string;
  description: string;
}

export const PAGES = {
  landing: {
    path: '/',
    title: '大字屏 BIGWORDS — 把一句话，铺满整块屏幕',
    description: '在手机、平板、电视或任何带浏览器的屏幕上，把想说的话变成占满屏幕的大字。接机、倒计时、店铺 Wi-Fi、演出应援。免费、无需注册、开源，链接即全部。',
  },
  app: {
    path: '/app',
    title: '写大字 · 大字屏',
    description: '选一个效果，写一句话，调好颜色就全屏播放。文字和颜色会留在本机，也可以连接其他屏幕遥控播放。',
  },
  docs: {
    path: '/docs',
    title: 'Docs: URL reference · 大字屏',
    description: 'Every BIGWORDS URL parameter: formatting, fonts, size, colors, animations, slides, countdowns, QR codes, images and self-hosting.',
  },
} as const satisfies Record<string, PageMeta>;

/** Served with status 404 for unknown paths. Not indexed and not in the sitemap. */
export const NOT_FOUND = {
  title: 'Page not found · 大字屏',
  description: 'There is no page at this address.',
} as const;
