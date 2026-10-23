import { sitePath } from './paths';

/** Move to another page of this site without a reload, then let the router run. */
export function go(url: string): void {
  const next = new URL(sitePath(url), location.href);
  const here = location.pathname + location.search + location.hash;
  const there = next.pathname + next.search + next.hash;
  if (here === there) return;
  history.pushState(null, '', there);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
