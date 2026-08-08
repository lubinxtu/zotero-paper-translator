// build.mjs
// 用 esbuild 把 src/ 打包为单文件 ESM，并复制静态文件到 addon/。
import * as esbuild from "esbuild";
import { copyFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
const addon = path.join(root, "addon");

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

console.log("build done -> addon/");
