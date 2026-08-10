// extract.js
// 使用 pdfjs-dist 从 PDF 抽取文本，并按行重建、识别结构块。
// 结构块类型见 glossary.js 的 BLOCK。
//
// worker 说明（Zotero 沙箱兼容）：
// Zotero 给插件 bootstrap 的是无 DOM 的 Cu.Sandbox（无 window/document），
// pdfjs 的真实 worker 路径会因引用 window.location 而失败并自动回退到 fake worker，
// fake worker 用 `import(workerSrc)` 在主线程加载 worker 模块（沙箱内可用）。
// 因此这里把 pdf.worker.min.mjs 作为独立文件打进 xpi，用 import.meta.url 定位，
// 与 bundle 自身的 jar:file 动态导入机制一致。

import * as pdfjsLib from "pdfjs-dist";

let _workerReady = false;
function ensureWorker() {
  if (_workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdf.worker.min.mjs",
    import.meta.url
  ).href;
  _workerReady = true;
}

// 按 y 坐标把 pdfjs 的 text items 聚合成"行"，再按 x 排序拼成字符串。
function groupIntoLines(items) {
  const lines = [];
  let cur = null;
  let lastY = null;
  // 按 y 降序、x 升序排序
  const sorted = items.slice().sort((a, b) => {
    const ya = a.transform[5];
    const yb = b.transform[5];
    if (Math.abs(ya - yb) > 2) return yb - ya;
    return a.transform[4] - b.transform[4];
  });
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) > 2) {
      cur = { y, texts: [] };
      lines.push(cur);
      lastY = y;
    }
    cur.texts.push(it);
  }
  return lines.map((line) => {
    const ordered = line.texts.sort((a, b) => a.transform[4] - b.transform[4]);
    let s = "";
    let prevX = null;
    for (const t of ordered) {
      const x = t.transform[4];
      if (prevX !== null && x - prevX > 2 && s && !s.endsWith(" ")) s += " ";
      s += t.str;
      prevX = x + (t.width || 0);
    }
    return s.replace(/\s+/g, " ").trim();
  }).filter((s) => s.length > 0);
}

// 判断一行属于哪种结构块
const RE_SECTION = /^(#{1,3}\s|I{1,3}V?|X{0,3}I{0,3}V?X{0,3})\b/; // 章节编号 I. II. 1. 1.1 等
const RE_FIG = /^fig\.?\s*\d+/i;
// 数值+单位（表格行特征之一）
const RE_NUM_UNIT = /\d+(?:\.\d+)?\s*(?:%|ms|cm|mm|μm|nm|m|s|ms|px|dB|°|kHz|MHz|GHz|MB|GB|KB)/i;

function classify(line) {
  if (RE_SECTION.test(line)) {
    // 顶级章节 vs 子节
    if (/^(I{1,3}V?|X{0,3}I{0,3}V?X{0,3})\.\s/.test(line)) return "H2";
    if (/^\d+\.\s/.test(line)) return "H2";
    if (/^\d+\.\d+\s/.test(line)) return "H3";
    return "H3";
  }
  if (RE_FIG.test(line)) return "FIG";
  // 表格行：≥3 个数值片段，或 2 个数值片段且带单位/百分号。
  // 阈值设高一些，避免 "In 2019, 35% of …" 这类正文句被误判为表格。
  const numMatches = (line.match(/\d+(?:\.\d+)?/g) || []).length;
  if (numMatches >= 3 && /[\d.]+\s+[\d.]+/.test(line)) return "TABLE";
  if (numMatches >= 2 && RE_NUM_UNIT.test(line)) return "TABLE";
  return "P";
}

// 主抽取函数
// dataBytes: Uint8Array；workerSrc: worker 资源 URL；onProgress(page,total)
// 返回 { blocks: [{type, text}] }
export async function extractPDF(dataBytes, onProgress) {
  ensureWorker();

  const loadingTask = pdfjsLib.getDocument({
    data: dataBytes,
    useWorkerFetch: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const blocks = [];
  let tableBuffer = [];

  const flushTable = () => {
    if (tableBuffer.length) {
      blocks.push({ type: "TABLE", text: tableBuffer.join("\n") });
      tableBuffer = [];
    }
  };

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items);
    for (const line of lines) {
      const type = classify(line);
      if (type === "TABLE") {
        tableBuffer.push(line);
      } else {
        flushTable();
        blocks.push({ type, text: line });
      }
    }
    flushTable();
    if (onProgress) onProgress(p, doc.numPages);
  }

  try { await loadingTask.destroy(); } catch (e) {}
  return { blocks };
}
