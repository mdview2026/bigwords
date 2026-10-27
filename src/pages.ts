// Titles and descriptions for the indexable pages. The build writes them into
// each page's static HTML (vite-plugin-docs.ts) and main.ts sets the same
// titles at runtime, so the two never disagree.

export const SITE_NAME = '大字屏';

/**
 * Site-level search keywords (Baidu still reads the keywords meta; Google
 * ignores it). Emitted on every page's head by the build.
 */
export const KEYWORDS =
  '大字屏,全屏大字,滚动字幕,手持弹幕,荧光字幕,LED字幕,弹幕屏,接机牌,应援大字,大字滚动,big text,fullscreen text';

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
  /** Overrides the template's zh-CN <html lang>; the reference is in English. */
  lang?: string;
}

export const PAGES = {
  landing: {
    path: '/',
    title: '大字屏 BIGWORDS — 全屏大字工具，把一句话铺满整块屏幕',
    description: '免费的全屏大字与滚动字幕工具：在手机、平板、电视上把一句话铺满屏幕。支持手持弹幕、荧光字、倒计时与二维码，接机、应援、店铺 Wi-Fi、直播提词都能用。无需注册，文字只留在本机。',
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
    lang: 'en',
  },
} as const satisfies Record<string, PageMeta>;

/** Served with status 404 for unknown paths. Not indexed and not in the sitemap. */
export const NOT_FOUND = {
  title: 'Page not found · 大字屏',
  description: 'There is no page at this address.',
} as const;
