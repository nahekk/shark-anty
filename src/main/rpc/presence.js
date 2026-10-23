'use strict';
const { EventEmitter } = require('node:events');
const { DiscordIPC } = require('./discord-ipc');
const store = require('../store');
const launcher = require('../browser/launcher');
const log = require('../log');

/**
 * Discord Rich Presence for Shark{anty} - same behaviour as the Dolphin{Anty} RPC:
 *
 *   no open profiles  -> details "No open profiles", state "🌑 Download from: sha.best" (moon animation)
 *   one profile       -> details "Profile/s: <name>",  state "Using proxy: socks5" | "No proxy"
 *   several profiles  -> details "Profile/s: A, B, C +N", state "Using proxy: socks5, http, no proxy +N"
 *   small image text  -> "<N> profile(s)"
 *
 * Shows as "Playing Shark{anty}" when the Discord application is named Shark{anty}.
 */
const MOON_PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕'];
const IDLE_INTERVAL = 4000; // Discord rate-limits updates to ~1 per 4 s
const POLL_INTERVAL = 10000;
const RECONNECT_DELAY = 5000;

class Presence extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.timer = null;
    this.frame = 0;
    this.startTs = Math.floor(Date.now() / 1000);
    this.status = { state: 'disabled', user: null, error: null };
    this.lastPayload = null;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    launcher.on('changed', () => this._kick());
    store.on('settings', () => this.restart());
    this._loop();
  }

  restart() {
    const cfg = store.settings.rpc;
    if (this.client && this.client.clientId !== cfg.clientId) this._disconnect();
    if (!cfg.enabled && this.client) this._disconnect(true);
    this._kick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this._disconnect(true);
  }

  _kick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._loop(), 300);
  }

  _setStatus(s) {
    this.status = { ...this.status, ...s };
    this.emit('status', this.status);
  }

  async _loop() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const cfg = store.settings.rpc;
    let next = POLL_INTERVAL;

    if (!cfg.enabled) {
      this._setStatus({ state: 'disabled', error: null });
      this.timer = setTimeout(() => this._loop(), POLL_INTERVAL);
      return;
    }
    if (!/^\d{15,22}$/.test(cfg.clientId || '')) {
      this._setStatus({ state: 'no-client-id', error: null });
      this.timer = setTimeout(() => this._loop(), POLL_INTERVAL);
      return;
    }

    try {
      if (!this.client || !this.client.ready) await this._connect(cfg.clientId);
      const { payload, idle } = this.buildPresence();
      const key = JSON.stringify(payload);
      if (key !== this.lastPayload) {
        await this.client.setActivity(payload);
        this.lastPayload = key;
      }
      this.frame++;
      next = idle ? IDLE_INTERVAL : POLL_INTERVAL;
      this._setStatus({ state: 'connected', error: null });
    } catch (e) {
      const notFound = e.code === 'DISCORD_NOT_FOUND';
      this._setStatus({ state: notFound ? 'discord-not-running' : 'error', error: notFound ? null : e.message });
      if (!notFound) log.warn('Discord RPC:', e.message);
      this._disconnect();
      next = RECONNECT_DELAY;
    }
    this.timer = setTimeout(() => this._loop(), next);
  }

  async _connect(clientId) {
    this._disconnect();
    const client = new DiscordIPC(clientId);
    await client.connect();
    client.on('disconnected', () => {
      if (this.client === client) {
        this.client = null;
        this.lastPayload = null;
        this._kick();
      }
    });
    this.client = client;
    this.lastPayload = null;
    this.startTs = Math.floor(Date.now() / 1000);
    this._setStatus({ user: client.user ? client.user.username : null });
    log.info('Discord RPC connected' + (client.user ? ` as ${client.user.username}` : ''));
  }

  _disconnect(clear = false) {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    this.lastPayload = null;
    if (clear && c.ready) {
      c.clearActivity()
        .catch(() => {})
        .finally(() => c.close());
    } else {
      c.close();
    }
  }

  // ---- presence content (mirrors dolphin-anty-rpc/main.py) ----
  proxyType(profile) {
    const proxy = store.getProxy(profile.proxyId);
    return proxy ? proxy.type : '';
  }

  proxyLabel(profile) {
    const cfg = store.settings.rpc;
    const proxy = store.getProxy(profile.proxyId);
    if (!proxy) return '';
    if (cfg.proxyDisplay === 'hidden') return 'proxy';
    if (cfg.proxyDisplay === 'country' && proxy.lastCheck && proxy.lastCheck.countryCode) {
      return `${proxy.type} (${proxy.lastCheck.countryCode})`;
    }
    return proxy.type;
  }

  buildPresence() {
    const cfg = store.settings.rpc;
    const open = launcher
      .list()
      .filter((e) => !e.headless && e.state !== 'starting')
      .map((e) => store.getProfile(e.id))
      .filter(Boolean);

    const base = {
      assets: {
        large_image: cfg.largeImage || 'logo',
        large_text: cfg.largeText || 'Shark{anty}',
        small_image: cfg.smallImage || 'small_logo',
      },
      timestamps: { start: this.startTs },
      instance: false,
    };

    if (!open.length) {
      const moon = MOON_PHASES[this.frame % MOON_PHASES.length];
      return {
        idle: true,
        payload: { ...base, details: 'No open profiles', state: `${moon} Download from: sha.best` },
      };
    }

    const name = (p) => (cfg.showNames ? p.name : 'hidden');
    let details;
    let state;
    if (open.length === 1) {
      const p = open[0];
      details = `Profile/s: ${name(p)}`;
      const label = this.proxyLabel(p);
      state = label ? `Using proxy: ${label}` : 'No proxy';
    } else {
      const shown = open.slice(0, 3);
      let names = shown.map(name).join(', ');
      let types = shown.map((p) => this.proxyLabel(p) || 'no proxy').join(', ');
      if (open.length > 3) {
        const extra = ` +${open.length - 3}`;
        names += extra;
        types += extra;
      }
      details = `Profile/s: ${names}`;
      state = `Using proxy: ${types}`;
    }

    return {
      idle: false,
      payload: {
        ...base,
        details: pad(details.slice(0, 128)),
        state: pad(state.slice(0, 128)),
        assets: { ...base.assets, small_text: `${open.length} profile(s)` },
      },
    };
  }
}

// Discord requires at least 2 characters.
function pad(s) {
  return s.length < 2 ? s + ' ' : s;
}

module.exports = new Presence();
