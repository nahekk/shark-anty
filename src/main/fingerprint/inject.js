'use strict';

/**
 * Builds the script that runs in every page/frame before the page's own code.
 * It only patches what CDP cannot set natively: screen, deviceMemory, WebGL
 * vendor/renderer and small stable noise for canvas/WebGL/audio/rects.
 * Patched functions look native (toString) and live on the prototypes, like
 * the originals.
 */
function pagePayload(cfg) {
  const native = new WeakMap();
  const fnToString = Function.prototype.toString;
  const toStringProxy = new Proxy(fnToString, {
    apply(target, self, args) {
      if (native.has(self)) return `function ${native.get(self)}() { [native code] }`;
      return Reflect.apply(target, self, args);
    },
  });
  native.set(toStringProxy, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: toStringProxy, writable: true, configurable: true, enumerable: false });

  const define = (obj, prop, desc) => {
    try {
      Object.defineProperty(obj, prop, desc);
    } catch (e) {}
  };

  function getter(proto, prop, fn) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    const g = Object.getOwnPropertyDescriptor({ get [prop]() { return fn.call(this, desc.get); } }, prop).get;
    native.set(g, `get ${prop}`);
    define(proto, prop, { ...desc, get: g });
  }

  function method(proto, name, wrap) {
    if (!proto || typeof proto[name] !== 'function') return;
    const orig = proto[name];
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    const fn = { [name](...args) { return wrap(orig, this, args); } }[name];
    define(fn, 'length', { value: orig.length });
    native.set(fn, name);
    define(proto, name, { ...desc, value: fn });
  }

  // stable pseudo-random per (seed, n)
  const hash = (n) => {
    let x = (cfg.seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };

  // ---- hardware / screen
  if (cfg.deviceMemory) getter(Navigator.prototype, 'deviceMemory', () => cfg.deviceMemory);
  if (cfg.hardwareConcurrency) getter(Navigator.prototype, 'hardwareConcurrency', () => cfg.hardwareConcurrency);
  if (cfg.screen) {
    const w = cfg.screen.width;
    const h = cfg.screen.height;
    const bar = cfg.os === 'macos' ? 25 : cfg.os === 'windows' ? 40 : 0;
    getter(Screen.prototype, 'width', () => w);
    getter(Screen.prototype, 'height', () => h);
    getter(Screen.prototype, 'availWidth', () => w);
    getter(Screen.prototype, 'availHeight', () => h - bar);
    getter(Screen.prototype, 'colorDepth', () => 24);
    getter(Screen.prototype, 'pixelDepth', () => 24);
  }

  // ---- canvas
  const noisify = (data) => {
    if (!data || data.length > 16e6) return;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = hash(i);
      if ((r & 15) === 0) {
        const c = (r >>> 4) % 3;
        data[i + c] = data[i + c] ^ 1;
      }
    }
  };

  if (cfg.noise.canvas && typeof CanvasRenderingContext2D !== 'undefined') {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    method(CanvasRenderingContext2D.prototype, 'getImageData', (orig, self, args) => {
      const img = orig.apply(self, args);
      noisify(img.data);
      return img;
    });
    const noisyCopy = (canvas) => {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h || w * h > 4e6) return null;
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const img = origGetImageData.call(ctx, 0, 0, w, h);
      noisify(img.data);
      ctx.putImageData(img, 0, 0);
      return copy;
    };
    method(HTMLCanvasElement.prototype, 'toDataURL', (orig, self, args) => {
      try {
        const c = noisyCopy(self);
        if (c) return origToDataURL.apply(c, args);
      } catch (e) {}
      return orig.apply(self, args);
    });
    method(HTMLCanvasElement.prototype, 'toBlob', (orig, self, args) => {
      try {
        const c = noisyCopy(self);
        if (c) return origToBlob.apply(c, args);
      } catch (e) {}
      return orig.apply(self, args);
    });
  }

  // ---- WebGL
  for (const ctx of [typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext, typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext]) {
    if (!ctx) continue;
    if (cfg.webgl) {
      method(ctx.prototype, 'getParameter', (orig, self, args) => {
        if (args[0] === 0x9245) return cfg.webgl.vendor;
        if (args[0] === 0x9246) return cfg.webgl.renderer;
        return orig.apply(self, args);
      });
    }
    if (cfg.noise.webgl) {
      method(ctx.prototype, 'readPixels', (orig, self, args) => {
        const r = orig.apply(self, args);
        const px = args[6];
        if (px && px.length) noisify(px);
        return r;
      });
    }
  }

  // ---- audio
  if (cfg.noise.audio && typeof AudioBuffer !== 'undefined') {
    const done = new WeakSet();
    method(AudioBuffer.prototype, 'getChannelData', (orig, self, args) => {
      const d = orig.apply(self, args);
      if (!done.has(d)) {
        done.add(d);
        for (let i = 0; i < d.length; i += 97) d[i] += ((hash(i) % 2001) - 1000) * 1e-8;
      }
      return d;
    });
    if (typeof AnalyserNode !== 'undefined') {
      method(AnalyserNode.prototype, 'getFloatFrequencyData', (orig, self, args) => {
        const r = orig.apply(self, args);
        const arr = args[0];
        if (arr) for (let i = 0; i < arr.length; i += 7) arr[i] += ((hash(i) % 201) - 100) * 1e-5;
        return r;
      });
    }
  }

  // ---- client rects
  if (cfg.noise.rects && typeof DOMRect !== 'undefined') {
    const d = ((cfg.seed % 1000) + 1) * 1e-7;
    const shift = (r) => new DOMRect(r.x + d, r.y + d, r.width + d, r.height + d);
    method(Element.prototype, 'getBoundingClientRect', (orig, self, args) => shift(orig.apply(self, args)));
    if (typeof Range !== 'undefined') method(Range.prototype, 'getBoundingClientRect', (orig, self, args) => shift(orig.apply(self, args)));
  }

  // ---- fonts: tiny per-seed noise on text measurement, so font enumeration by
  // width differs from the real machine
  if (cfg.noise.fonts) {
    const d = ((hash(777) % 1000) / 1000) * 0.02 + 0.001;
    method(CanvasRenderingContext2D.prototype, 'measureText', (orig, self, args) => {
      const m = orig.apply(self, args);
      try {
        const w = m.width + d;
        Object.defineProperty(m, 'width', { get: () => w, configurable: true });
      } catch (e) {}
      return m;
    });
    for (const prop of ['offsetWidth', 'offsetHeight']) {
      getter(HTMLElement.prototype, prop, function (orig) {
        const v = orig.call(this);
        return v === 0 ? 0 : v + (hash(v) % 2);
      });
    }
  }

  // ---- hide webdriver (set because of the DevTools port used for cookies)
  getter(Navigator.prototype, 'webdriver', () => false);

  // ---- Do Not Track
  if (cfg.doNotTrack) {
    getter(Navigator.prototype, 'doNotTrack', () => '1');
    try {
      define(window, 'doNotTrack', { get: () => '1', configurable: true });
    } catch (e) {}
  }

  // ---- WebGPU
  if (cfg.webgpuBlock && 'gpu' in navigator) {
    getter(Navigator.prototype, 'gpu', () => undefined);
  }

  // ---- media devices: stable fake microphone/speaker/camera set per seed
  if (cfg.noise.mediaDevices && typeof MediaDevices !== 'undefined') {
    const id = (n) => {
      let s = '';
      for (let i = 0; i < 4; i++) s += hash(n * 10 + i).toString(16).padStart(8, '0');
      return s;
    };
    const groups = [id(1), id(2)];
    const fake = [
      { kind: 'audioinput', label: '', deviceId: id(11), groupId: groups[0] },
      { kind: 'videoinput', label: '', deviceId: id(12), groupId: groups[1] },
      { kind: 'audiooutput', label: '', deviceId: id(13), groupId: groups[0] },
    ];
    method(MediaDevices.prototype, 'enumerateDevices', () =>
      Promise.resolve(
        fake.map((f) => ({ ...f, toJSON() { return f; } })),
      ),
    );
  }

  // ---- port protection: block page attempts to reach local services
  if (cfg.ports && cfg.ports.length) {
    const blocked = new Set(cfg.ports);
    const isBlocked = (url) => {
      try {
        const u = new URL(url, location.href);
        return blocked.has(Number(u.port)) && /^(127\.|0\.0\.0\.0|localhost|\[::1\])/.test(u.hostname);
      } catch (e) {
        return false;
      }
    };
    method(window, 'fetch', (orig, self, args) => (isBlocked(args[0] && args[0].url ? args[0].url : args[0]) ? Promise.reject(new TypeError('Failed to fetch')) : orig.apply(self, args)));
    method(XMLHttpRequest.prototype, 'open', (orig, self, args) => {
      if (isBlocked(args[1])) throw new DOMException('Blocked', 'SecurityError');
      return orig.apply(self, args);
    });
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      const WS = new Proxy(OrigWS, {
        construct(target, args) {
          if (isBlocked(args[0])) throw new DOMException('Blocked', 'SecurityError');
          return Reflect.construct(target, args);
        },
      });
      define(window, 'WebSocket', { value: WS, writable: true, configurable: true });
    }
  }
}

function workerPayload(cfg) {
  const native = new WeakMap();
  const fnToString = Function.prototype.toString;
  const p = new Proxy(fnToString, {
    apply(t, self, args) {
      return native.has(self) ? `function ${native.get(self)}() { [native code] }` : Reflect.apply(t, self, args);
    },
  });
  native.set(p, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: p, writable: true, configurable: true, enumerable: false });
  const proto = typeof WorkerNavigator !== 'undefined' ? WorkerNavigator.prototype : null;
  const set = (prop, value) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    const g = Object.getOwnPropertyDescriptor({ get [prop]() { return value; } }, prop).get;
    native.set(g, `get ${prop}`);
    Object.defineProperty(proto, prop, { ...desc, get: g });
  };
  if (cfg.deviceMemory) set('deviceMemory', cfg.deviceMemory);
  if (cfg.hardwareConcurrency) set('hardwareConcurrency', cfg.hardwareConcurrency);
}

function config(resolved) {
  return {
    os: resolved.os,
    seed: resolved.seed >>> 0,
    deviceMemory: resolved.deviceMemory,
    hardwareConcurrency: resolved.hardwareConcurrency,
    screen: resolved.screen,
    webgl: resolved.webgl,
    noise: resolved.noise,
    doNotTrack: resolved.doNotTrack,
    webgpuBlock: resolved.webgpuBlock,
    ports: resolved.ports,
  };
}

const pageScript = (resolved) => `(${pagePayload.toString()})(${JSON.stringify(config(resolved))});`;
const workerScript = (resolved) => `(${workerPayload.toString()})(${JSON.stringify(config(resolved))});`;

module.exports = { pageScript, workerScript };
