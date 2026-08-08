// index.js
// 编排：选中条目 → 找到 PDF 附件 → 抽取 → 翻译 → 渲染 → 存为 Zotero 子附件（HTML/可打印 PDF）。
// 由 bootstrap.js 在用户点击菜单/按钮时调用。

import { extractPDF } from "./extract.js";
import { translateBlocks } from "./translate.js";
import { renderHTML } from "./render.js";
import { loadPrefs } from "./prefs.js";
import { createProgress, alert } from "./ui.js";

// 取当前选中的 PDF 目标：返回 [{pdfItem, parentItem}]
function getPDFTargets() {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return [];
  const items = pane.getSelectedItems();
  const targets = [];
  const seen = new Set();
  for (const item of items) {
    if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
      if (!seen.has(item.id)) { seen.add(item.id); targets.push({ pdfItem: item, parentItem: item.parentItem }); }
    } else if (!item.isAttachment()) {
      const children = item.getAttachments(true);
      for (const cid of children) {
        const child = Zotero.Items.get(cid);
        if (child && child.attachmentContentType === "application/pdf" && !seen.has(cid)) {
          seen.add(cid);
          targets.push({ pdfItem: child, parentItem: item });
        }
      }
    }
  }
  return targets;
}

function getItemMeta(item) {
  if (!item || item.isAttachment()) {
    // 用父项信息
    const parent = item ? item.parentItem : null;
    item = parent || item;
  }
  const title = item ? (item.getField("title") || "") : "";
  let authors = "";
  try {
    const creators = item.getCreators();
    authors = creators.map((c) => `${c.firstName || ""} ${c.lastName || ""}`.trim()).join(", ");
  } catch (e) {}
  return { title, authors };
}

async function readBytes(path) {
  // Zotero 7 (Firefox 115)：IOUtils.read 返回 Uint8Array
  if (typeof IOUtils !== "undefined" && IOUtils.read) {
    return await IOUtils.read(path);
  }
  throw new Error("无法读取文件（IOUtils 不可用）");
}

async function writeTextFile(path, text) {
  const encoder = new TextEncoder();
  if (typeof IOUtils !== "undefined" && IOUtils.write) {
    await IOUtils.write(path, encoder.encode(text));
    return;
  }
  throw new Error("无法写入临时文件（IOUtils 不可用）");
}

function getTempPath(name) {
  const dir = Zotero.getTempDirectory().clone();
  dir.append(name);
  return dir.path;
}

async function nsIFileFromPath(path) {
  const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
  file.initWithPath(path);
  return file;
}

async function run(pdfItem, parentItem, prefs, progress) {
  const path = pdfItem.getFilePath();
  if (!path) throw new Error("找不到 PDF 文件路径（可能是链接附件）");

  progress.setText("读取 PDF…");
  const bytes = await readBytes(path);

  progress.setText("抽取文本…");
  let extracted;
  try {
    extracted = await extractPDF(bytes, (p, t) => {
      progress.setText(`抽取文本 ${p}/${t}`);
    });
  } catch (e) {
    throw new Error("PDF 抽取失败：" + e.message);
  }

  progress.setText("翻译中…");
  const translated = await translateBlocks(extracted.blocks, prefs, (done, total) => {
    progress.setProgress(Math.round((done / total) * 80) + 5);
    progress.setText(`翻译 ${done}/${total}`);
  });
  if (translated._errors && translated._errors.length) {
    alert("部分段落翻译失败", `已保留原文。失败 ${translated._errors.length} 段。`);
  }

  const meta = getItemMeta(parentItem || pdfItem);
  const html = renderHTML(translated, meta);

  progress.setText("生成 HTML 附件…");
  const baseName = (meta.title || pdfItem.getField("title") || "paper").replace(/[\\/:*?"<>|]/g, "_");
  const tmpPath = getTempPath(`${baseName}_中译.html`);
  await writeTextFile(tmpPath, html);

  // 作为子附件导入 Zotero
  const file = await nsIFileFromPath(tmpPath);
  const attachment = await Zotero.Attachments.importFromFile({
    file,
    parentItemID: parentItem ? parentItem.id : pdfItem.id,
    title: `${meta.title || "论文"}（中译）`,
  });
  // 清理临时文件
  try { await IOUtils.remove(tmpPath, { ignoreAbsent: true }); } catch (e) {}

  progress.setProgress(100);
  if (prefs.outputMode === "pdf") {
    // 打开 HTML（含"打印/另存为 PDF"按钮），由用户在浏览器中导出 PDF
    try { Zotero.launchURL(attachment.getFilePath()); } catch (e) {}
  }
  return attachment;
}

export async function translateSelected() {
  const prefs = loadPrefs();
  if (!prefs.apiKey) {
    alert("未配置 API Key", "请在 Zotero 首选项 → 论文翻译 中填写 LLM API Key 与端点。");
    return;
  }
  const targets = getPDFTargets();
  if (!targets.length) {
    alert("未选择 PDF", "请选中一篇文献或其 PDF 附件后再执行翻译。");
    return;
  }
  const progress = createProgress("论文翻译");
  let ok = 0;
  for (const t of targets) {
    try {
      await run(t.pdfItem, t.parentItem, prefs, progress);
      ok++;
    } catch (e) {
      progress.error(e.message);
    }
  }
  progress.finish(ok > 0, `完成 ${ok}/${targets.length}`);
  if (ok > 0 && prefs.outputMode !== "pdf") {
    alert("翻译完成", `已为 ${ok} 篇文献生成中译 HTML 附件，可在 Zotero 中打开查看（含公式渲染）。`);
  }
}

export { getPDFTargets };
