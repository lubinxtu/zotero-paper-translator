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

await esbuild.build({
  entryPoints: [path.join(root, "src/index.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "firefox115",
  outfile: path.join(addon, "index.js"),
  loader: { ".txt": "text" },
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
