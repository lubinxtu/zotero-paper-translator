// build.mjs
// 用 esbuild 把 src/ 打包为单文件 ESM，并复制静态文件到 addon/。
import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, rm } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
const addon = path.join(root, "addon");

// 清空并重建 addon/，保证产物确定（不残留旧的空目录/文件）
await rm(addon, { recursive: true, force: true });
await mkdir(addon, { recursive: true });

// Zotero 插件沙箱（Cu.Sandbox）没有 DOM 全局，pdfjs 主模块顶层 `new DOMMatrix()`
// 会抛 ReferenceError 导致整个 bundle import 失败；另外 pdfjs v6 用到了较新的
// Uint8Array.prototype.toHex（Firefox 140 系/Node 24 均未实现），抽取时会崩。
// 这里在 bundle 顶部打最小桩（只做文本抽取，不会真正走到 canvas 渲染路径；
// Uint8Array 桩挂在共享原型上，动态 import 的 worker 模块同样可见）。
const DOMMATRIX_STUB = `if (typeof DOMMatrix === "undefined") {
  class ZPTDOMMatrixStub {
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
  }
  globalThis.DOMMatrix = ZPTDOMMatrixStub;
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
  format: "esm",
  platform: "browser",
  target: "firefox115",
  outfile: path.join(addon, "index.js"),
  banner: { js: DOMMATRIX_STUB },
  logLevel: "info",
});

const staticFiles = ["bootstrap.js", "manifest.json", "preferences.xhtml"];
for (const f of staticFiles) {
  await copyFile(path.join(root, f), path.join(addon, f));
}

// locale/ 必须在 xpi 内：Zotero 启动时读取 [plugin root]/locale/<locale>/*.ftl
// 注册进统一的 L10nRegistry（zotero-plugins 源），MenuManager 的 l10nID 才能解析。
await cp(path.join(root, "locale"), path.join(addon, "locale"), { recursive: true });

// pdf.js worker 作为独立文件打进 xpi，运行时由 fake worker 的 import(workerSrc) 加载
await copyFile(
  path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  path.join(addon, "pdf.worker.min.mjs")
);

console.log("build done -> addon/");
