import { describe, expect, it } from 'vitest';
import { portablePath, routeFromLocation } from '../src/paths';

describe('portable paths', () => {
  it('maps pages to html files next to index', () => {
    expect(portablePath('/')).toBe('./index.html');
    expect(portablePath('/?e=poster')).toBe('./index.html?e=poster');
    expect(portablePath('/#Hello')).toBe('./index.html#Hello');
    expect(portablePath('/editor')).toBe('./editor.html');
    expect(portablePath('/editor#Hi')).toBe('./editor.html#Hi');
    expect(portablePath('/docs')).toBe('./docs.html');
    expect(portablePath('/guide')).toBe('./guide.html');
    expect(portablePath('/favicon.svg')).toBe('./favicon.svg');
    expect(portablePath('/fonts/inter/a.woff2')).toBe('./fonts/inter/a.woff2');
  });

  it('reads the page from a file path or a server path', () => {
    expect(routeFromLocation('/', '', '')).toBe('landing');
    expect(routeFromLocation('/index.html', '', '')).toBe('landing');
    expect(routeFromLocation('/app', '', '')).toBe('app');
    expect(routeFromLocation('/app.html', '', '#Hello')).toBe('app');
    expect(routeFromLocation('/F:/site/index.html', '?role=player', '')).toBe('player');
    expect(routeFromLocation('/index.html', '?role=control', '')).toBe('control');
    expect(routeFromLocation('/index.html', '?role=player', '#Hello')).toBe('viewer');
    expect(routeFromLocation('/F:/site/index.html', '?e=chalk', '')).toBe('studio');
    expect(routeFromLocation('/F:/site/index.html', '', '#Hello')).toBe('viewer');
    expect(routeFromLocation('/editor', '', '#Hi')).toBe('notfound');
    expect(routeFromLocation('/C:/site/docs.html', '', '')).toBe('docs');
    expect(routeFromLocation('/guide.html', '', '')).toBe('notfound');
    expect(routeFromLocation('/missing', '', '')).toBe('notfound');
  });
});
