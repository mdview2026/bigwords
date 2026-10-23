# 大字屏 (BIGWORDS)

**English** | [简体中文](README.zh-CN.md)

Full-screen text for any screen. Type a message in the editor and it fills the screen, as big as it fits. The whole display lives in the URL, so there's no backend, no accounts and nothing stored on a server. The public instance is <https://bigwords.cn>, which also distributes an Android app that embeds the site as an offline build.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/media/demo-poster.png">
  <img src="docs/media/demo.gif" width="600" alt="Three example displays: a handwritten &quot;Welcome home, Grandma!&quot; sign, a quiz countdown timer, and a café Wi-Fi password with a QR code.">
</picture>

## Using it

- **Landing** `/`: the site's front door — what it is, what it can do, and a playable demo whose 「去全屏播放」 button opens the real display.
- **Composer** `/app`: pick an effect, write the words, choose two colors and play. Recent words and colors stay in this browser. **控制其他屏幕** hands the same sign to the remote-control flow.
- **Viewer** `/#…`: the display itself, fullscreen, with no controls. This is the link you share, bookmark or open on the screen. (The fragment is also why the composer lives at `/app`: any hash on `/` is a display.)
- **Docs** `/docs`: the reference, built from [`docs/REFERENCE.md`](docs/REFERENCE.md). All of the URL parameters are documented, so generating links is easy.

Features:

- Text fits itself to any screen size and orientation
- A small Markdown subset: bold, italic, headings, line breaks
- Slides, split with `||`
- Countdowns to a date and time (`until`) or for a length of time (`timer`)
- Animations, bundled open-source fonts and aspect-ratio framing
- QR codes drawn in the browser: links, Wi-Fi, calls, texts, email, locations
- Images, and keeping the screen awake while a display is open

The display lives in the URL fragment (after the `#`), which browsers never send to the server.

## Self-hosting

The build is a folder of static files, so any static host works if it serves `index.html` for `/`, `app.html` for `/app`, `docs.html` for `/docs`, and `404.html` with status 404 for any other path. The portable build (`npm run build:site`, the `网站/` directory) instead opens straight into the composer, which is also what the Android app embeds. If your host sends a Content-Security-Policy, copy the `script-src` from the [`Caddyfile`](Caddyfile): `index.html` has one inline script, allowed by its hash. The supported way to run it is the Docker image.

### Docker

The image is the official `caddy` image serving the build from `/usr/share/caddy`, with a Caddyfile that listens on `:80`, sets the security headers and serves `404.html` for unknown paths.

```sh
git clone https://github.com/mdview2026/bigwords.git
cd bigwords
docker compose up -d --build
```

`compose.yaml` publishes no ports (port 80 is listed but commented out). Attach the service to your reverse proxy's network and let the proxy handle TLS. The proxy should also send `Strict-Transport-Security`.

The image keeps the stock Caddy defaults, including running as root, so it behaves like any other `caddy` container. The site is static and holds no secrets, but if you want to lock the container down further, these compose settings work with it:

```yaml
services:
  bigwords:
    read_only: true
    tmpfs:
      - /data
      - /config
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE] # needed to listen on :80
    security_opt: [no-new-privileges:true]
    mem_limit: 128m
    cpus: 0.5
```

To run as a non-root user as well, change the Caddyfile to listen on a port above 1024 (for example `:8080`), add `user: "1000:1000"`, and point your proxy and the Dockerfile `HEALTHCHECK` at the new port.

### Build settings

All optional. Set them as environment variables for `npm run build`, or as build args in `compose.yaml` (`build.args`) or `docker build --build-arg`.

| Setting | Effect |
|---|---|
| `SITE_URL` | Your public origin, e.g. `https://signs.example.com`. Adds canonical URLs, Open Graph/Twitter image tags, home page JSON-LD and `sitemap.xml`, all of which need an absolute URL. Without it they're left out. |
| `NOINDEX` | `1` adds `noindex` to every page, makes `robots.txt` disallow everything and drops the sitemap. For staging copies and private instances. |
| `OPERATOR_DOCS` | Path to a Markdown file appended to `/docs`, for notes about your instance, such as who runs it and how to report abuse. Relative to the repository root. |
| `VITE_MQTT_URL` | The MQTT-over-WebSocket endpoint (`wss://…`) baked into the build for the remote-control feature. Defaults to the public instance's broker; set it when you run your own (see [Remote control](#remote-control)). |

### Remote control

The remote-control feature — one phone driving other screens over MQTT — needs a broker. Out of the box the build points at the public instance's broker, whose credentials are not in this repository. To use the feature on your own instance:

1. Run any MQTT broker with a WebSocket listener and create a user for the site, for example [Mosquitto](https://mosquitto.org/) with `listener 1883` and `protocol websockets` plus a `password_file`.
2. Copy [`src/remote/local_settings.example.ts`](src/remote/local_settings.example.ts) to `src/remote/local_settings.ts` and fill in that username and password.
3. Build with `VITE_MQTT_URL=wss://your-broker.example.com/mqtt` (a build arg of the Docker image too).

The player puts the broker URL in its QR code, so controllers and screens follow the broker they were paired with, not the one in the build.

## Development

Requires Node 22.12+. CI and the Docker build use the LTS release in [`.node-version`](.node-version), currently 24.

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # static output in dist/
npm run preview    # serve dist/ on :4173
npm run smoke      # browser smoke test against the preview server (Playwright)
npm run clipcheck  # checks that no glyph ink is clipped at the text area edges
```

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the unit tests, build and smoke test on every push to `main` and every pull request. Clipcheck runs too, but its result doesn't fail the build.

The remote-control feature talks to an MQTT broker whose credentials are not part of the repository. Copy [`src/remote/local_settings.example.ts`](src/remote/local_settings.example.ts) to `src/remote/local_settings.ts` and fill in the username and password before building. CI builds with the placeholder file.

The social card `public/og.png` and `public/apple-touch-icon.png` are rendered with the real viewer by `npm run og` (with `npm run preview` running) and committed. Re-run it after changing the fonts or the favicon.

Project layout:

| Path | Purpose |
|---|---|
| `src/state/` | Fragment parsing/serialization, parameter validation and defaults |
| `src/render/text.ts` | Message pipeline: escapes → slides → markdown → `{countdown}` |
| `src/render/display.ts` | The renderer shared by the viewer, editor preview and home page |
| `src/editor/` | Editor UI |
| `docs/REFERENCE.md` | Documentation source, rendered into `/docs` at build time |
| `public/fonts/` | Vendored fonts with their licenses (`npm run fonts` regenerates them) |

## License

[MIT](LICENSE). This project is a secondary development of [BIGWORDS.PAGE](https://github.com/SpeakingOfBrad/BIGWORDS.PAGE) by SpeakingOfBrad, used under the MIT license. Bundled fonts and libraries keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
