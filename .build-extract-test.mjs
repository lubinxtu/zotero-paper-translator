import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(fileURLToPath(import.meta.url));
const STUBS = `if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    translate(x, y) { this.e += x; this.f += y; return this; }
    scale(x, y) { this.a *= x; this.d *= (y === undefined ? x : y); return this; }
    multiply(m) { return this; }
    multiplySelf(m) { return this; }
    preMultiplySelf(m) { return this; }
    invertSelf() { return this; }
    rotate() { return this; }
    addPath() {}
  };
}
if (typeof globalThis.performance === "undefined") {
  globalThis.performance = { now: () => Date.now() };
}
if (typeof globalThis.console === "undefined") {
  // 沙箱 wantGlobalProperties 不含 console，pdfjs 的 info/warn 会直接崩
  globalThis.console = {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}
if (typeof globalThis.AbortSignal === "undefined") {
  globalThis.AbortSignal = class AbortSignal {
    constructor() { this.aborted = false; this.reason = undefined; }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
    throwIfAborted() {
      if (this.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
    }
    static any() { return new AbortSignal(); }
    static timeout() { return new AbortSignal(); }
    static abort(reason) { const s = new AbortSignal(); s.aborted = true; s.reason = reason; return s; }
  };
}
if (typeof globalThis.AbortController === "undefined") {
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = new globalThis.AbortSignal(); }
    abort(reason) { this.signal.aborted = true; this.signal.reason = reason; }
  };
}
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function () {
    let s = "";
    for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, "0");
    return s;
  };
}
if (typeof Uint8Array.fromHex !== "function") {
  Uint8Array.fromHex = function (hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}
if (typeof Uint8Array.prototype.toBase64 !== "function") {
  Uint8Array.prototype.toBase64 = function () {
    let s = "";
    for (const b of this) s += String.fromCharCode(b);
    return btoa(s);
  };
}
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}`;
await esbuild.build({
  entryPoints: [path.join(root, "src/extract.js")],
  bundle: true,
  format: "iife",
  globalName: "ZPT",
  platform: "browser",
  target: "firefox115",
  outfile: "C:/Users/15617/AppData/Local/Temp/zpt-test/extract-iife.js",
  banner: { js: STUBS },
  logLevel: "error",
});
console.log("built");
