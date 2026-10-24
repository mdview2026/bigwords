import './styles/base.css';
import './styles/display.css';
import { routeFromLocation, type SiteRoute } from './paths';
import { NOT_FOUND, PAGES, SITE_NAME } from './pages';
import { effectById } from './simple/effects';
import { syncPlayerLink } from './remote/player-link';
import { syncJoinLink } from './remote/join-link';
import { mountViewer } from './viewer';

type Route = SiteRoute;
type Mounted = { update?(): void; destroy(): void };

const app = document.getElementById('app')!;
// index.html carries the prerendered landing page (the composer, in the
// portable build). Keep it for the route it belongs to; everything else
// clears it, and the mount functions render their own markup over it.
if (app.hasAttribute('data-prerendered')) {
  const first = currentRoute();
  if (first !== 'landing' && first !== 'app') app.replaceChildren();
  app.removeAttribute('data-prerendered');
}
let route: Route | null = null;
let mounted: Mounted | null = null;
let generation = 0;
/* The landing remounts its whole tree when the route comes back to it, which
   happens after the browser's own scroll restoration has already run (and
   clamped to 0 against the viewer's fixed stage). Remember where it was
   scrolled to, and put it back when the viewer hands the page back. */
let landingScrollY = 0;

function currentRoute(): Route {
  return routeFromLocation(location.pathname, location.search, location.hash);
}

function titleFor(r: Route): string {
  if (r === 'viewer') return SITE_NAME;
  if (r === 'notfound') return NOT_FOUND.title;
  if (r === 'studio') {
    const effect = effectById(new URLSearchParams(location.search).get('e') ?? '');
    return effect ? `${effect.name} · ${SITE_NAME}` : `调整文字 · ${SITE_NAME}`;
  }
  if (r === 'player' || r === 'join') return `播放端 · ${SITE_NAME}`;
  if (r === 'control' || r === 'host') return `控制端 · ${SITE_NAME}`;
  return PAGES[r].title;
}

async function load(r: Route): Promise<Mounted> {
  switch (r) {
    case 'viewer':
      return mountViewer(app);
    case 'studio':
      return (await import('./simple/studio')).mountStudio(app);
    case 'player':
      return (await import('./remote/player-page')).mountPlayer(app);
    case 'control':
      return (await import('./remote/console')).mountConsole(app, 'scan');
    case 'host':
      return (await import('./remote/console')).mountConsole(app, 'show');
    case 'join':
      return (await import('./remote/join-page')).mountJoin(app);
    case 'docs':
      return (await import('./docs')).mountDocs(app);
    case 'landing':
      return (await import('./landing/landing')).mountLanding(app);
    case 'notfound':
      return (await import('./notfound')).mountNotFound(app);
    default:
      // 'app' and anything unexpected: the composer.
      return (await import('./simple/quick')).mountQuick(app);
  }
}

async function render(): Promise<void> {
  const r = currentRoute();
  if (r === route) {
    // The viewer and the not-found page re-render in place when the fragment
    // changes; the editor and docs pages handle their own fragment changes.
    if (r === 'viewer' || r === 'notfound') mounted?.update?.();
    return;
  }
  const gen = ++generation;
  const prev = route;
  if (prev === 'landing') landingScrollY = window.scrollY;
  mounted?.destroy();
  mounted = null;
  route = r;
  // The viewer's title never includes the message.
  document.title = titleFor(r);
  syncPlayerLink(r);
  syncJoinLink(r);
  const m = await load(r);
  if (gen !== generation) {
    m.destroy();
    return;
  }
  mounted = m;
  if (r === 'landing' && prev === 'viewer') window.scrollTo(0, landingScrollY);
}

window.addEventListener('hashchange', () => void render());
window.addEventListener('popstate', () => void render());
void render();
