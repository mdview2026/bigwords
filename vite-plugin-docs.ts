import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Marked } from 'marked';
import type { Plugin } from 'vite';
import fontManifest from './src/render/font-manifest.json';
import { landingMarkup } from './src/landing/landing-markup.ts';
import { quickMarkup } from './src/simple/quick-markup.ts';
import { rewritePortableHrefs } from './src/paths.ts';
import { NOT_FOUND, PAGES, SITE_NAME, apkUrl, type PageMeta } from './src/pages.ts';

const VIRTUAL_ID = 'virtual:docs';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const DOCS_PATH = resolve(import.meta.dirname, 'docs/REFERENCE.md');
// The repo-root VERSION file, shown in the composer footer (src/version.ts
// carries the same number into the client bundle via vite's define).
const APP_VERSION = readFileSync(resolve(import.meta.dirname, 'VERSION'), 'utf8').trim();

/**
 * Optional Markdown appended to the reference, for notes about one particular
 * instance (who runs it, how to reach them). Relative to the working directory.
 */
function operatorDocsPath(): string | undefined {
  const path = process.env.OPERATOR_DOCS;
  return path ? resolve(path) : undefined;
}

// Box-drawing characters come from whatever fallback font has them, at that
// font's width, so diagrams drawn with them don't line up with the text.
// Each run (└───, ───┘ or ───) becomes one span, exactly as many characters
// wide, that CSS draws with borders; browsers snap borders to whole pixels,
// so the lines stay crisp at any zoom. The characters stay inside
// (transparent) so copying still works.
const BOX_RUNS: [RegExp, string][] = [
  [/^└─*$/, 'l'],
  [/^─*┘$/, 'r'],
  [/^─+$/, 'h'],
];

function drawBoxChars(html: string): string {
  return html.replace(/<pre>[\s\S]*?<\/pre>/g, (pre) =>
    pre.replace(/└─*|─*┘|─+/g, (run) => {
      const kind = BOX_RUNS.find(([re]) => re.test(run))![1];
      return `<span class="bx bx-${kind}" style="--n:${[...run].length}">${run}</span>`;
    }),
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Renders docs/REFERENCE.md to HTML. Example URLs keep their {origin} placeholder. */
function renderDocs(): string {
  const extra = operatorDocsPath();
  const md = readFileSync(DOCS_PATH, 'utf8') + (extra ? '\n' + readFileSync(extra, 'utf8') : '');
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html);
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
    },
  });
  return drawBoxChars(marked.parse(md, { async: false }) as string)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The public origin (SITE_URL), used for canonical URLs, social cards, the
 * sitemap and example URLs in the prerendered docs. Empty when unset: the
 * build then leaves out everything that needs an absolute URL.
 */
function siteUrl(): string {
  const url = process.env.SITE_URL;
  return url ? new URL(url).origin : '';
}

/** NOINDEX=1 keeps a build out of search engines, e.g. for staging or a private instance. */
function isNoindex(): boolean {
  return /^(1|true|yes)$/i.test(process.env.NOINDEX ?? '');
}

/**
 * Title, description, canonical, Open Graph and Twitter tags for one page.
 * Canonical and og:url/og:image need an absolute URL, so they're only written
 * when SITE_URL is set.
 */
function headTags(page: PageMeta, site: string, noindex: boolean): string {
  const url = site + page.path;
  const meta = (attr: 'name' | 'property', key: string, value: string) => `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`;
  const tags = [
    `<title>${escapeAttr(page.title)}</title>`,
    meta('name', 'description', page.description),
    noindex ? meta('name', 'robots', 'noindex') : '',
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
  ];
  if (site) {
    tags.push(
      `<link rel="canonical" href="${escapeAttr(url)}" />`,
      meta('property', 'og:url', url),
      meta('property', 'og:image', `${site}/og.png`),
      meta('property', 'og:image:width', '1200'),
      meta('property', 'og:image:height', '630'),
      meta('property', 'og:image:alt', '大字屏 (BIGWORDS): big words for any screen'),
      meta('name', 'twitter:card', 'summary_large_image'),
    );
    if (page === PAGES.landing) tags.push(jsonLd(site));
  } else {
    tags.push(meta('name', 'twitter:card', 'summary'));
  }
  return tags.filter(Boolean).join('\n    ');
}

/** Structured data for the landing page. A data block, so the CSP doesn't apply. */
function jsonLd(site: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${site}/#website`, name: SITE_NAME, url: `${site}/` },
      {
        '@type': 'WebApplication',
        name: SITE_NAME,
        url: `${site}/app`,
        description: PAGES.landing.description,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/licenses/MIT',
      },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * index.html holds the prerendered home page, but it also serves every
 * display (/#message). This inline script runs before the first paint and
 * marks the page when there's a fragment, so a display never flashes the
 * home page while its script loads. The CSP allows it by hash: keep
 * DISPLAY_GUARD_HASH in the Caddyfile's script-src (a unit test checks).
 */
export const DISPLAY_GUARD = "if(location.hash.length>1)document.documentElement.classList.add('has-display')";
export const DISPLAY_GUARD_HASH = `'sha256-${createHash('sha256').update(DISPLAY_GUARD).digest('base64')}'`;
const DISPLAY_GUARD_TAGS = `<style>html.has-display #app[data-prerendered]{display:none}</style>\n    <script>${DISPLAY_GUARD}</script>`;

/** Fallback for visitors and crawlers without JavaScript. */
function noscript(page: PageMeta): string {
  // Every prerendered page reads fine without JavaScript: the landing and the
  // docs are static text, and the composer carries its own note.
  void page;
  return '';
}

/** Static copy of what siteHeader() in src/chrome.ts renders. */
function staticHeader(current?: 'home' | 'editor' | 'docs' | 'guide'): string {
  const link = (href: string, label: string, key: string) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  // On the home page the right side is the installer download instead of the nav
  // (siteHeader renders the same swap). It is a real link, so the prerendered
  // page downloads the APK without JavaScript; the client intercepts the click.
  const nav = current === 'home'
    ? `<a class="btn btn-primary btn-sm" data-apk href="${apkUrl(APP_VERSION)}">下载安装版</a>`
    : `<nav class="site-nav">${link('/', '首页', 'home')}${link('/docs', 'Docs', 'docs')}</nav>`;
  return (
    '<header class="site-header"><a class="wordmark" href="/" aria-label="大字屏 home">大字屏</a>' +
    `${nav}</header>`
  );
}

function fillPage(template: string, page: PageMeta, site: string, noindex: boolean): string {
  return template
    .replace('<!-- seo:head -->', () => headTags(page, site, noindex))
    .replace('<!-- seo:noscript -->', () => noscript(page));
}

/**
 * A site page (header + main) prerendered into #app, with the site styles
 * linked up front so it's styled before, or without, JavaScript. The client
 * renders the same markup over it.
 */
/**
 * @font-face rules for the site's display font (the wordmark and headings),
 * as ensureFont() in src/render/fonts.ts registers them. In the prerendered
 * pages' <head>, the font loads as soon as text uses it rather than after the
 * script runs, so headings don't paint in the fallback first.
 */
function displayFontFaces(assetBase: string): string {
  const entry = Object.values(fontManifest).find((f) => f.slug === 'bebas-neue');
  if (!entry) throw new Error('bigwords-pages: Bebas Neue missing from the font manifest');
  const prefix = `${assetBase}fonts/`;
  return entry.faces
    .map((f) => `@font-face{font-family:"bw-${entry.slug}";src:url("${prefix}${f.file}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:swap;unicode-range:${f.range};}`)
    .join('');
}

function prerender(html: string, cssLinks: string, body: string, assetBase: string, appAttrs = ''): string {
  return html
    .replace('</head>', `  ${cssLinks}\n    <style>${displayFontFaces(assetBase)}</style>\n  </head>`)
    .replace('<body>', '<body class="page-site">')
    .replace('<div id="app"></div>', () => `<div id="app"${appAttrs}>${body}</div>`);
}

/**
 * The composer page: /app in the deployed build, and index.html in the
 * portable build. Prerendered with the display guard when the file also
 * serves display links (index.html); app.html is only ever the composer, so
 * it skips the guard. Marked data-prerendered: the guard hides it on display
 * links, and main.ts keeps it until mountQuick renders over it.
 */
function appPage(template: string, cssLinks: string, site: string, noindex: boolean, assetBase: string, guard: boolean): string {
  const note = '<noscript><p class="noscript-note">写大字和连接屏幕需要 JavaScript。</p></noscript>';
  const html = prerender(fillPage(template, PAGES.app, site, noindex), cssLinks, `${staticHeader('home')}${note}${quickMarkup(APP_VERSION)}`, assetBase, ' data-prerendered');
  // First in <head>, so it runs before anything else loads.
  return guard ? html.replace('<head>', `<head>\n    ${DISPLAY_GUARD_TAGS}`) : html;
}

/**
 * The landing page, prerendered into the deployed build's index.html. The
 * guard runs first in <head>: a display link (/#…) never flashes the landing
 * while the script loads. `cssLinks` here also carries landing.css, which is
 * otherwise a runtime chunk style, so the page is styled before — or
 * without — JavaScript.
 */
function landingPage(template: string, cssLinks: string, site: string, noindex: boolean, assetBase: string): string {
  const html = prerender(fillPage(template, PAGES.landing, site, noindex), cssLinks, landingMarkup(APP_VERSION), assetBase, ' data-prerendered');
  return html.replace('<head>', `<head>\n    ${DISPLAY_GUARD_TAGS}`);
}

/** /guide, the original reference home, retired into a redirect to /. */
function guideRedirect(): string {
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>大字屏</title>\n<meta name="robots" content="noindex">\n<meta http-equiv="refresh" content="0;url=/">\n</head>\n<body></body>\n</html>\n`;
}

/** Static copy of what mountNotFound() in src/notfound.ts renders, minus the fragment link. */
function notFoundPage(template: string, cssLinks: string, assetBase: string): string {
  const head = [
    `<title>${escapeAttr(NOT_FOUND.title)}</title>`,
    `<meta name="description" content="${escapeAttr(NOT_FOUND.description)}" />`,
    '<meta name="robots" content="noindex" />',
  ].join('\n    ');
  const body =
    '<h1>Page not found</h1><p>There’s no page at this address. Displays live on the home page, after the # in the URL.</p>' +
    '<p><a href="/">Home</a> · <a href="/docs">Docs</a></p>';
  return prerender(
    template.replace('<!-- seo:head -->', () => head).replace('<!-- seo:noscript -->', ''),
    cssLinks,
    `${staticHeader()}<main><article class="docs">${body}</article></main>`,
    assetBase,
  );
}

/**
 * The double-click build opens as a file. Browsers refuse external module
 * scripts from file://, so the script is inlined, and root links become
 * relative html files.
 */
function finishPortablePage(html: string, bundle: Record<string, { type: string; code?: string }>, drop: Set<string>): string {
  let out = rewritePortableHrefs(html).replace(/url\((["']?)\/fonts\//g, 'url($1./fonts/');
  out = out.replace(/ crossorigin(?:="[^"]*")?/g, '');
  out = out.replace(/<link\b[^>]*rel="modulepreload"[^>]*>\s*/gi, '');
  out = out.replace(/<script\b([^>]*)>\s*<\/script>/gi, (full, attrs: string) => {
    if (!/\btype="module"/.test(attrs)) return full;
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    if (!src) return full;
    const key = src.replace(/^\.\//, '').replace(/^\//, '');
    const chunk = bundle[key];
    if (!chunk || chunk.type !== 'chunk' || typeof chunk.code !== 'string') {
      throw new Error(`bigwords-pages: portable build could not inline ${src}`);
    }
    drop.add(key);
    return `<script type="module">${chunk.code.replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  const seenCss = new Set<string>();
  out = out.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>\s*/g, (tag, href: string) => {
    if (seenCss.has(href)) return '';
    seenCss.add(href);
    return tag;
  });
  if (!out.includes('<script type="module">')) throw new Error('bigwords-pages: portable page has no inlined script');
  return out;
}

/**
 * Renders docs/REFERENCE.md (plus OPERATOR_DOCS, if set) to HTML at build
 * time and exposes it as `virtual:docs`, so the /docs route and the README
 * share one source.
 *
 * At build time it also writes one HTML file per page (index.html,
 * editor.html, docs.html) with that page's metadata, prerenders the home page
 * and the docs so they're readable without JavaScript, and writes 404.html,
 * robots.txt and, when SITE_URL is set, sitemap.xml.
 */
export default function docsPlugin(): Plugin[] {
  let command: 'build' | 'serve' = 'serve';
  let assetBase = '/';
  let portable = false;
  return [
    {
      name: 'bigwords-docs',
      configResolved(config) {
        command = config.command;
        assetBase = config.base;
        portable = config.mode === 'portable';
      },
      resolveId(id) {
        return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
      },
      load(id) {
        if (id !== RESOLVED_ID) return undefined;
        this.addWatchFile(DOCS_PATH);
        const extra = operatorDocsPath();
        if (extra) this.addWatchFile(extra);
        return `export default ${JSON.stringify(renderDocs())};`;
      },
      // Serve unknown paths the way production does (404.html with status
      // 404), so `npm run preview` and the smoke test see real 404s.
      configurePreviewServer(server) {
        const out = resolve(server.config.root, server.config.build.outDir);
        const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
        server.middlewares.use((req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          let path: string;
          try {
            path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
          } catch {
            return next();
          }
          const base = path.replace(/\/+$/, '');
          if (base === '' || isFile(join(out, path)) || isFile(join(out, `${base}.html`))) return next();
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(readFileSync(join(out, '404.html')));
        });
      },
      transformIndexHtml(html) {
        // The build fills the SEO markers per page in writeBundle.
        return command === 'serve' ? fillPage(html, PAGES.landing, siteUrl(), false) : html;
      },
    },
    {
      name: 'bigwords-pages',
      apply: 'build',
      writeBundle(options, bundle) {
        const out = options.dir!;
        const site = siteUrl();
        const noindex = isNoindex();
        const index = bundle['index.html'];
        if (index?.type !== 'asset') throw new Error('bigwords-pages: index.html missing from the bundle');
        const template = String(index.source);
        if (!template.includes('<!-- seo:head -->')) throw new Error('bigwords-pages: <!-- seo:head --> missing from index.html');

        // The site styles load with the lazy chrome chunk. The prerendered
        // pages link them up front, so they're styled before JS runs.
        const css = new Set<string>();
        for (const [file, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'chunk' && chunk.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith('/src/chrome.ts'))) {
            chunk.viteMetadata?.importedCss.forEach((f) => css.add(f));
          }
          if (portable && file.endsWith('.css')) css.add(file);
        }
        if (css.size === 0) {
          const files = Object.keys(bundle).join(', ');
          throw new Error(`bigwords-pages: no CSS found for the chrome chunk (${files})`);
        }
        const linkTags = (files: Iterable<string>) =>
          [...files].map((f) => `<link rel="stylesheet" crossorigin href="${assetBase}${f.replace(/^\//, '')}">`).join('\n    ');
        const cssLinks = linkTags(css);

        // The landing's styles travel with its runtime chunk; index.html
        // links them up front too, so the prerendered landing is styled
        // before (or without) JavaScript. Vite's loader sees the link and
        // does not inject it twice at runtime.
        const landingCss = new Set<string>();
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith('/src/landing/landing.ts'))) {
            chunk.viteMetadata?.importedCss.forEach((f) => landingCss.add(f));
          }
        }
        const landingCssLinks = linkTags(new Set([...css, ...landingCss]));

        // Without SITE_URL, example links become relative (/#…); the client
        // swaps in the real origin when it renders the docs.
        const origin = escapeAttr(site);
        const article = renderDocs().replace(/\{origin\}|%7Borigin%7D/gi, origin);
        const drop = new Set<string>();
        const page = (html: string) => (portable ? finishPortablePage(html, bundle, drop) : html);
        const docs = page(prerender(fillPage(template, PAGES.docs, site, noindex), cssLinks, `${staticHeader('docs')}<main><article class="docs">${article}</article></main>`, assetBase));

        // The portable build (double-clicked file, APK asset): the composer is
        // the index and there is no landing page or app.html. The deployed
        // build opens on the landing page, with the composer one click in.
        if (portable) {
          writeFileSync(resolve(out, 'index.html'), page(appPage(template, cssLinks, site, noindex, assetBase, true)));
        } else {
          writeFileSync(resolve(out, 'index.html'), page(landingPage(template, landingCssLinks, site, noindex, assetBase)));
          writeFileSync(resolve(out, 'app.html'), page(appPage(template, cssLinks, site, noindex, assetBase, false)));
        }
        // guide.html redirects old inbound /guide links to the landing. The
        // portable build leaves it out: nothing there links to it, and the
        // APK asset checker requires an inlined module in every html page.
        if (!portable) writeFileSync(resolve(out, 'guide.html'), guideRedirect());
        writeFileSync(resolve(out, 'docs.html'), docs);
        writeFileSync(resolve(out, '404.html'), page(notFoundPage(template, cssLinks, assetBase)));
        if (portable) {
          writeFileSync(resolve(out, '打开.bat'), '@echo off\r\nstart "" "%~dp0index.html"\r\n');
          for (const key of drop) {
            const file = resolve(out, key);
            if (existsSync(file)) unlinkSync(file);
          }
        }

        if (noindex) {
          writeFileSync(resolve(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
          return;
        }
        if (!site) {
          writeFileSync(resolve(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
          return;
        }
        writeFileSync(resolve(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
        const urls = Object.values(PAGES)
          .map((p) => `  <url><loc>${escapeAttr(site + p.path)}</loc></url>`)
          .join('\n');
        writeFileSync(
          resolve(out, 'sitemap.xml'),
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        );
      },
    },
  ];
}
