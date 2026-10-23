<p align="center">
  <img src="build/icon.png" width="96" alt="Shark{anty}" />
</p>

<h1 align="center">Shark{anty}</h1>

<p align="center">
  Multi-profile browser built on Chromium. Separate proxy, cookies and
  fingerprint per profile. No account, no limits.
</p>

<p align="center">
  <a href="https://sha.best"><b>Download</b></a> ·
  <a href="#build">Build</a> ·
  <a href="#local-api">API</a>
</p>

![Profiles](docs/screenshot-profiles.png)

## Overview

Each profile runs as an isolated Chromium instance with its own
`--user-data-dir`, upstream proxy and fingerprint. Profiles don't share
cookies, storage or logins. Electron handles the UI and process lifecycle;
fingerprints are applied over the DevTools Protocol.

## Features

**Profiles**
- Unlimited isolated profiles, each with its own cookies, storage, history and proxy
- Bulk create, clone, tags, start pages, per-profile command-line switches
- Chromium (latest) with Google services + H.264/AAC by default, or ungoogled-chromium.
  The engine is downloaded on first run and updatable from the UI.

**Fingerprints**
- Consistent, randomized fingerprint per profile; every field is editable, or disabled per profile
- User-Agent and client hints, platform/OS, screen, CPU, memory, MAC, device name
- Canvas, WebGL (vendor/renderer from real GPUs), WebGPU, audio, client-rect and font noise
- Timezone, language and geolocation derived from the proxy IP or set manually
- WebRTC policy (hide local IP / real / disabled), media-device masking, DNT, port protection
- `navigator.webdriver` stays `false` with no automation-flag warning bar
- Applied to pages, iframes and workers via a DevTools session that pauses each target until the overrides are in place

**Proxies**
- SOCKS5, SOCKS4 and HTTP, with or without auth, or no proxy
- Paste a URI in any common format (`socks5://user:pass@host:port`, `host:port:user:pass`, …); it is parsed, saved and checked
- A local per-profile bridge forwards to the upstream proxy and performs the auth, so DNS resolves through the proxy and does not leak
- Check reports exit IP, country, city, latency, ASN and proxy type (residential / ISP / datacenter / mobile)

**Cookies**
- Import/export JSON (Cookie-Editor, EditThisCookie, Puppeteer-style) and Netscape `cookies.txt`
- Whole profile or a single domain, including closed profiles
- Built-in extension to export/import cookies of the current site from the toolbar

**Other**
- Chrome Web Store extensions loaded into every profile
- Discord Rich Presence (built-in application, no setup)
- Local HTTP API for Puppeteer / Playwright / Selenium
- English / Polish / Russian, dark and light themes

![Editor](docs/screenshot-editor.png)

## Install

Download the installer from [sha.best](https://sha.best) and run it. On first
start, pick Chromium or ungoogled-chromium (downloaded once, ~150–450 MB).

The build is not code-signed, so SmartScreen/Gatekeeper may warn on first run.

Portable mode: place an empty file named `portable` next to the executable; all
data is then kept in a `data` folder beside it.

## Local API

Enable it in Settings. Every request requires `Authorization: Bearer <token>`.

```
GET    /v1/profiles
POST   /v1/profiles                          {"name":"Shop 1","proxy":"socks5://user:pass@host:1080"}
GET    /v1/profiles/:id/start[?headless=1]   -> { wsEndpoint }
GET    /v1/profiles/:id/stop
GET    /v1/profiles/:id/cookies[?format=netscape&domain=example.com]
POST   /v1/profiles/:id/cookies              (body: JSON or cookies.txt)
DELETE /v1/profiles/:id
```

## Architecture

```
Electron main
├─ profiles/<id>/     separate --user-data-dir per profile
├─ proxy bridge       127.0.0.1 listener per running profile -> upstream SOCKS/HTTP (handles auth, remote DNS)
├─ fingerprint        DevTools session; pauses each new target and installs overrides before it runs
├─ extension          built-in cookie import/export, loaded in every profile
└─ discord            native IPC Rich Presence client
```

Fingerprint overrides apply to pages, frames and workers. Installed fonts and
some low-level system details remain the host's, so selecting an OS different
from the host can be detected by advanced checks.

## Build

```bash
npm install
npm start            # development
npm test             # unit + proxy/fingerprint end-to-end tests
npm run dist         # Windows installer   -> dist/SharkAnty-Setup-x.y.z.exe
npm run dist:mac     # macOS .dmg (on macOS)
npm run dist:linux   # Linux AppImage (on Linux)
```

Each platform is built on its own OS. `.github/workflows/release.yml` builds all
three (push a `vX.Y.Z` tag or run it manually) and attaches the installers to a
draft release.

## Releases

Releases are hosted at [sha.best](https://sha.best). `WEBSITE` and `UPDATE_FEED`
in `src/main/config.js` point the in-app update check at a small JSON feed:

```json
{ "version": "1.3.0", "url": "https://sha.best", "notes": "" }
```

## License

[MIT](LICENSE)
