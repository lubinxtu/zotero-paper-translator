// extract.js
// 使用 pdfjs-dist 从 PDF 抽取文本，并按行重建、识别结构块。
// 结构块类型见 glossary.js 的 BLOCK。

import * as pdfjsLib from "pdfjs-dist";
// 将 pdf.js worker 源码以文本形式打入包内，运行时用 blob 加载（避免插件内解析外部 worker 资源的麻烦）。
import workerSource from "../resources/pdf.worker.raw.txt";

let _workerReady = false;
function ensureWorker() {
  if (_workerReady) return;
  const blob = new Blob([workerSource], { type: "text/javascript" });
  const workerSrc = URL.createObjectURL(blob);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  if ("workerType" in pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerType = "module";
  }
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
const RE_TABLE_ROW = /([\d.±%]+\s*(?:ms|cm|m|s|px|dB|°)?\s*)/; // 含数字的行（粗略）

function classify(line) {
  if (RE_SECTION.test(line)) {
    // 顶级章节 vs 子节
    if (/^(I{1,3}V?|X{0,3}I{0,3}V?X{0,3})\.\s/.test(line)) return "H2";
    if (/^\d+\.\s/.test(line)) return "H2";
    if (/^\d+\.\d+\s/.test(line)) return "H3";
    return "H3";
  }
  if (RE_FIG.test(line)) return "FIG";
  // 表格行：行内出现至少两个数字片段
  const numMatches = (line.match(/[\d.]+/g) || []).length;
  if (numMatches >= 2 && /[\d.]+\s+[\d.]+/.test(line)) return "TABLE";
  return "P";
}

// 主抽取函数
// dataBytes: Uint8Array；workerSrc: worker 资源 URL；onProgress(page,total)
// 返回 { blocks: [{type, text}] }
export async function extractPDF(dataBytes, onProgress) {
  ensureWorker();

  const doc = await pdfjsLib.getDocument({ data: dataBytes, useWorkerFetch: true, isEvalSupported: false }).promise;
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

  await doc.destroy();
  return { blocks };
}
