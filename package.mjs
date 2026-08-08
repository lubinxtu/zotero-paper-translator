// package.mjs
// 将 addon/ 目录打包为 .xpi（Zotero 可安装的插件包）。使用纯 JS 的 archiver，无原生依赖。
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const root = path.dirname(fileURLToPath(import.meta.url));
const addon = path.join(root, "addon");
const out = path.join(root, "zotero-paper-translator.xpi");

await mkdir(root, { recursive: true });

await new Promise((resolve, reject) => {
  const output = createWriteStream(out);
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(addon, false);
  archive.finalize();
});

console.log("packaged ->", out);
