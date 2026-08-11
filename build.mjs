// build.mjs
// 用 esbuild 把 src/ 打包为单文件 IIFE，并复制静态文件到 addon/。
//
// 为什么是 IIFE + loadSubScript（而不是 ESM + 动态 import）：
// Zotero 插件 bootstrap 跑在无 DOM 的 Cu.Sandbox 里，动态 import() 会抛
// "No ScriptLoader found for the current context"，只能由 bootstrap 用
// Services.scriptloader.loadSubScript(rootURI + "index.js", ctx) 加载经典脚本。
// globalName 让导出挂到 var ZPT 上（loadSubScript 的 target 对象可见）。
import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, rm } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
const addon = path.join(root, "addon");

// 清空并重建 addon/，保证产物确定（不残留旧的空目录/文件）
await rm(addon, { recursive: true, force: true });
await mkdir(addon, { recursive: true });

// Zotero 沙箱缺少的全局，在 bundle 顶部打最小桩（只做文本抽取，不会走到 canvas 渲染路径）：
// - DOMMatrix：pdfjs 主模块顶层 `new DOMMatrix()` 会抛 ReferenceError 导致加载失败
// - performance：pdfjs worker 的 setTimeout 计时工具用到 performance.now()
// - AbortSignal / AbortController：pdfjs MessageHandler 类字段 new AbortController、AbortSignal.any
// - Uint8Array.prototype.toHex / fromHex / toBase64：较新 API，Firefox 140 系/Node 24 均未实现
// - Promise.withResolvers：Firefox <119（Zotero 7）没有
// - ReadableStream 等由 src/polyfills.js（web-streams-polyfill）在 bundle 内补齐
// 注意：统一用 globalThis 挂载（realm 全局，pdfjs 的裸标识符读取最终落在这里）；
//      不要用顶层 `var` —— loadSubScript 的目标对象语义下 var 不一定对 free identifier 可见。
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
  entryPoints: [path.join(root, "src/index.js")],
  bundle: true,
  format: "iife",
  globalName: "ZPT",
  platform: "browser",
  target: "firefox115",
  outfile: path.join(addon, "index.js"),
  banner: { js: STUBS },
  logLevel: "info",
});

const staticFiles = ["bootstrap.js", "manifest.json", "preferences.xhtml"];
for (const f of staticFiles) {
  await copyFile(path.join(root, f), path.join(addon, f));
}

// locale/ 必须在 xpi 内：Zotero 启动时读取 [plugin root]/locale/<locale>/*.ftl
// 注册进统一的 L10nRegistry（zotero-plugins 源），MenuManager 的 l10nID 才能解析。
await cp(path.join(root, "locale"), path.join(addon, "locale"), { recursive: true });

console.log("build done -> addon/");
