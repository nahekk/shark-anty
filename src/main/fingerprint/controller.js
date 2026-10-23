'use strict';
const { CDPClient } = require('../browser/cdp');
const { pageScript, workerScript } = require('./inject');
const log = require('../log');

/**
 * Keeps one DevTools connection to a running profile and applies the profile's
 * fingerprint to every tab, iframe and worker the moment it is created (the
 * target is paused until the overrides are in place).
 */
// Browser level attaches to tabs (pages come through their tab), sessions below attach to everything else.
const BROWSER_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page', exclude: true }, {}] };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'tab', exclude: true }, {}] };

class FingerprintController {
  constructor(wsUrl, resolved, label = '') {
    this.wsUrl = wsUrl;
    this.fp = resolved;
    this.label = label;
    this.cdp = null;
    this.pageSrc = pageScript(resolved);
    this.workerSrc = workerScript(resolved);
  }

  async start() {
    this.cdp = await CDPClient.connect(this.wsUrl);
    this.cdp.on('Target.attachedToTarget', (p) => this._attached(p).catch(() => {}));
    await this.cdp.send('Target.setAutoAttach', BROWSER_ATTACH);
  }

  close() {
    if (this.cdp) this.cdp.close();
    this.cdp = null;
  }

  async openUrls(urls) {
    for (const url of urls || []) await this.cdp.send('Target.createTarget', { url }).catch(() => {});
  }

  async _attached({ sessionId, targetInfo, waitingForDebugger }) {
    const send = (m, p = {}) => this.cdp.send(m, p, sessionId, 10000);
    const type = targetInfo.type;
    const url = targetInfo.url || '';
    try {
      if (type === 'tab') {
        await send('Target.setAutoAttach', AUTO_ATTACH);
      } else if (type === 'page' || type === 'iframe') {
        if (!/^(chrome|devtools|chrome-untrusted):/.test(url)) await this._applyPage(send);
        await send('Target.setAutoAttach', AUTO_ATTACH);
        // Pages that were already open before we attached (restored session) get reloaded once.
        if (!waitingForDebugger && type === 'page' && /^https?:/.test(url)) await send('Page.reload', {});
      } else if (type === 'worker' || type === 'shared_worker' || type === 'service_worker') {
        await this._applyWorker(send);
      }
    } catch (e) {
      log.warn(`[fingerprint ${this.label}] ${type} ${url.slice(0, 80)}: ${e.message}`);
    } finally {
      if (waitingForDebugger) send('Runtime.runIfWaitingForDebugger').catch(() => {});
    }
  }

  async _applyPage(send) {
    const fp = this.fp;
    await send('Page.enable');
    const tasks = [send('Page.addScriptToEvaluateOnNewDocument', { source: this.pageSrc, runImmediately: true })];
    if (fp.userAgent) {
      tasks.push(
        send('Emulation.setUserAgentOverride', {
          userAgent: fp.userAgent,
          acceptLanguage: fp.acceptLanguage || undefined,
          platform: fp.platform || undefined,
          userAgentMetadata: fp.uaMetadata || undefined,
        }),
      );
    }
    if (fp.timezone) tasks.push(send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone }));
    if (fp.locale) tasks.push(send('Emulation.setLocaleOverride', { locale: fp.locale }).catch(() => {}));
    if (fp.hardwareConcurrency) tasks.push(send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fp.hardwareConcurrency }).catch(() => {}));
    if (fp.geo) tasks.push(send('Emulation.setGeolocationOverride', fp.geo));
    await Promise.all(tasks);
  }

  async _applyWorker(send) {
    const fp = this.fp;
    const tasks = [send('Runtime.evaluate', { expression: this.workerSrc }).catch(() => {})];
    if (fp.userAgent) {
      tasks.push(
        send('Network.setUserAgentOverride', {
          userAgent: fp.userAgent,
          acceptLanguage: fp.acceptLanguage || undefined,
          platform: fp.platform || undefined,
          userAgentMetadata: fp.uaMetadata || undefined,
        }).catch(() => {}),
      );
    }
    if (fp.timezone) tasks.push(send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone }).catch(() => {}));
    await Promise.all(tasks);
  }
}

module.exports = { FingerprintController };
