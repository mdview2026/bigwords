/**
 * Paths that work both on a web server and when the page is opened as a file.
 */

export type SiteRoute = 'landing' | 'app' | 'studio' | 'viewer' | 'player' | 'control' | 'host' | 'join' | 'docs' | 'notfound';

/**
 * True in the portable build (网站/, embedded in the APK), where the root is
 * the composer rather than the landing page: the app must work offline-first
 * with no marketing in between. Mirrors the MODE check in sitePath().
 */
function portableBuild(): boolean {
  try {
    return import.meta.env.MODE === 'portable';
  } catch {
    return false;
  }
}


/**
 * Turn a root-absolute site path into a relative file path.
 * `/editor` becomes `./editor.html`, `/?e=poster` becomes `./index.html?e=poster`.
 * Files that already have an extension, such as `/favicon.svg`, stay as files.
 */
export function portablePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const query = path.indexOf('?');
  const hash = path.indexOf('#');
  let cut = path.length;
  if (query >= 0) cut = Math.min(cut, query);
  if (hash >= 0) cut = Math.min(cut, hash);
  const pathname = path.slice(0, cut);
  const tail = path.slice(cut);
  if (pathname === '/' || pathname === '') return `./index.html${tail}`;
  const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (rel.includes('/') || /\.[a-z0-9]+$/i.test(rel)) return `./${rel}${tail}`;
  return `./${rel}.html${tail}`;
}

/** Rewrite root-absolute links in built HTML so a double-clicked file can follow them. */
export function rewritePortableHrefs(html: string): string {
  return html.replace(/href="(\/[^"]*)"/g, (_match, href: string) => `href="${portablePath(href)}"`);
}

/**
 * Link to another page of this site. The portable build uses relative files;
 * a normal build keeps root paths such as `/editor`.
 * Safe to call while the build plugin is prerendering in Node.
 */
export function sitePath(path: string): string {
  try {
    if (import.meta.env.MODE === 'portable') return portablePath(path);
  } catch {
    // Node evaluates this file during prerender, before Vite replaces import.meta.env.
  }
  return path;
}

/** Which screen the URL is asking for. Accepts `/docs` and `.../docs.html`. */
export function routeFromLocation(pathname: string, search: string, hash: string): SiteRoute {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  const file = path.split('/').filter(Boolean).pop() ?? '';
  const name = file.replace(/\.html$/i, '');
  if (name === 'docs') return 'docs';
  if (name === 'app') return 'app';
  if (name !== '' && name !== 'index') return 'notfound';
  if (hash.length > 1) return 'viewer';
  const role = new URLSearchParams(search).get('role');
  if (role === 'player') return 'player';
  if (role === 'control') return 'control';
  if (role === 'host') return 'host';
  if (role === 'join') return 'join';
  if (new URLSearchParams(search).get('e')) return 'studio';
  // The deployed site opens on the landing page; the portable build (opened as
  // a file, or embedded in the APK) opens straight into the composer.
  return portableBuild() ? 'app' : 'landing';
}
