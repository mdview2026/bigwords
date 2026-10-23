import html from 'virtual:docs';
import { h, siteHeader } from './chrome';
import { galleryPlaceholder, mountGallery } from './docs-gallery';
import { rewritePortableHrefs } from './paths';
import { safeDecode } from './state/fragment';

export function mountDocs(app: HTMLElement): { destroy(): void } {
  document.body.className = 'page-site';
  const article = h('article', { class: 'docs' });
  // The docs write example URLs with an {origin} placeholder (marked encodes it
  // as %7Borigin%7D inside links); show them on whatever host serves this build.
  const origin = (location.protocol === 'file:' ? '' : location.origin).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let rendered = galleryPlaceholder(html.replace(/\{origin\}|%7Borigin%7D/gi, origin));
  if (location.protocol === 'file:') rendered = rewritePortableHrefs(rendered);
  article.innerHTML = rendered;
  app.replaceChildren(siteHeader('docs'), h('main', {}, article));
  const stopGallery = mountGallery(article);
  if (location.hash) {
    document.getElementById(safeDecode(location.hash.slice(1)))?.scrollIntoView();
  }
  return { destroy: stopGallery };
}
