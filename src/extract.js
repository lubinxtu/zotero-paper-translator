// extract.js
// 使用 pdfjs-dist 从 PDF 抽取文本，并按行重建、识别结构块。
// 结构块类型见 glossary.js 的 BLOCK。
//
// 排版恢复要点：
// 1. 双栏检测：按行的 x 坐标做 k-means(k=2) 聚类，双栏页面按「左栏自上而下 → 右栏自上而下」
//    输出，避免左右栏同一高度的行混拼。
// 2. 段落合并：正文行按行距（y 间隙）与行尾标点合并为段落，给 LLM 完整上下文；
//    连字符断词（truncation ar- / gument）去连字符拼接。
// 3. 标题判定严格化：章节标题必须形如 "I. " / "1. " / "1.1. "（编号+点+空格）且行较短；
//    旧正则 X{0,3}I{0,3}V?X{0,3} 可匹配空串导致所有字母开头行都被误判为标题（H3 泛滥）。
//
// Zotero 沙箱兼容（关键）：
// - 插件 bootstrap 跑在无 DOM 的 Cu.Sandbox（无 window/document），且**不支持动态
//   import()**（会抛 "No ScriptLoader found for the current context"）。
// - 因此 pdf.js worker 通过静态 import 打进同一个 bundle；再走 pdfjs 官方主线程钩子
//   globalThis.pdfjsWorker（见 pdf.mjs 的 #mainThreadWorkerMessageHandler），
//   让 pdfjs 直接使用已加载的 WorkerMessageHandler，完全不做 new Worker / import(workerSrc)。

import * as pdfjsLib from "pdfjs-dist";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
// 沙箱缺失的 Web API（ReadableStream 等），必须先于 pdfjs 使用
import "./polyfills.js";

let _workerReady = false;
function ensureWorker() {
  if (_workerReady) return;
  try {
    globalThis.pdfjsWorker = pdfWorker;
  } catch (e) {}
  // workerSrc 实际不会被加载（fake worker 直接用上面的钩子），仅满足 pdfjs 的 getter 校验
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.mjs";
  _workerReady = true;
}

// ====== 结构分类 ======
// 章节标题：编号 + 点 + 空格（I. / II. / 1. / 1.1 / 1.1.1）。
// 注意备选分支必须至少匹配一个字符，绝不能匹配空串（否则所有行都会命中）。
const RE_HEADING = /^(?:[IVX]+|\d+(?:\.\d+)*)\.\s+/;
const RE_HEADING_ROMAN = /^[IVX]+\.\s+/;
const RE_FIG = /^fig\.?\s*\d+/i;
// 数值+单位（表格行特征之一）
const RE_NUM_UNIT = /\d+(?:\.\d+)?\s*(?:%|ms|cm|mm|μm|nm|m|s|ms|px|dB|°|kHz|MHz|GHz|MB|GB|KB)/i;

function classify(line) {
  // 标题：编号格式 + 行短（标题不会很长）+ 不以句号结尾（正文句会被排除）
  if (RE_HEADING.test(line) && line.length <= 120 && !/[.!?]$/.test(line)) {
    if (RE_HEADING_ROMAN.test(line) || /^\d+\.\s/.test(line)) return "H2";
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

// ====== 双栏检测：对页面所有 text item 的 x 坐标做 k-means(k=2) ======
// 必须在"行聚合"之前基于 item 判断 —— 若先聚合行，同一 y 的左右栏 item 已混成一行，聚类失效。
function detectTwoColumns(items) {
  if (items.length < 20) return null;
  const xs = items.map((it) => it.transform[4]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const span = maxX - minX;
  if (span < 10) return null;

  let c1 = minX + span * 0.3;
  let c2 = minX + span * 0.7;
  let prev1 = -1;
  let prev2 = -1;
  for (let i = 0; i < 12; i++) {
    let s1 = 0, s2 = 0, n1 = 0, n2 = 0;
    for (const x of xs) {
      if (Math.abs(x - c1) <= Math.abs(x - c2)) {
        s1 += x; n1++;
      } else {
        s2 += x; n2++;
      }
    }
    if (!n1 || !n2) break;
    const nc1 = s1 / n1;
    const nc2 = s2 / n2;
    if (Math.abs(nc1 - prev1) < 0.5 && Math.abs(nc2 - prev2) < 0.5) {
      c1 = nc1; c2 = nc2;
      break;
    }
    prev1 = c1; prev2 = c2;
    c1 = nc1; c2 = nc2;
  }
  const gap = Math.abs(c1 - c2);
  const splitX = (c1 + c2) / 2;
  const leftCount = xs.filter((x) => x <= splitX).length;
  const rightCount = xs.length - leftCount;
  // 两簇相距足够远（> 1/4 页宽）且两边都有内容才算双栏
  if (gap < span * 0.25 || leftCount < 5 || rightCount < 5) return null;
  return { splitX };
}

// 单栏行构建：按 y 聚合 → 行内按 x 拼接 → 返回 [{y, x, text}]
function buildColumnLines(items) {
  const sorted = items.slice().sort((a, b) => {
    const d = b.transform[5] - a.transform[5];
    if (Math.abs(d) > 2) return d;
    return a.transform[4] - b.transform[4];
  });
  const lines = [];
  let cur = null;
  let lastY = null;
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) > 2) {
      cur = { y, x: it.transform[4], items: [] };
      lines.push(cur);
      lastY = y;
    }
    cur.items.push(it);
  }
  return lines
    .map((line) => {
      const its = line.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
      let s = "";
      let prevX = null;
      for (const t of its) {
        const x = t.transform[4];
        if (prevX !== null && x - prevX > 2 && s && !s.endsWith(" ")) s += " ";
        s += t.str;
        prevX = x + (t.width || 0);
      }
      return { y: line.y, x: line.x, text: s.replace(/\s+/g, " ").trim() };
    })
    .filter((l) => l.text.length > 0);
}

// 分栏组装：双栏页面按「左栏（含跨栏的页眉/页脚/宽标题，按 y 插入）→ 右栏」输出
function groupIntoLines(items) {
  const twoCol = detectTwoColumns(items);
  if (!twoCol) {
    return buildColumnLines(items);
  }
  const splitX = twoCol.splitX;
  const cross = items.filter(
    (it) => it.transform[4] <= splitX && it.transform[4] + (it.width || 0) > splitX
  );
  const left = items.filter(
    (it) => it.transform[4] <= splitX && it.transform[4] + (it.width || 0) <= splitX
  );
  const right = items.filter((it) => it.transform[4] > splitX);
  const leftLines = buildColumnLines(left);
  const crossLines = buildColumnLines(cross);
  const rightLines = buildColumnLines(right);
  // 跨栏行（页眉/页脚/跨栏标题）按 y 与左栏行混合排序：页眉在页首、页脚在页尾
  const leftMerged = [...leftLines, ...crossLines].sort((a, b) => b.y - a.y);
  return [...leftMerged, ...rightLines];
}

// ====== 段落合并：按行距与行尾标点把正文行合并为段落 ======
function mergeParagraphs(lines) {
  // 估算行距（相邻行 y 差的中位数）
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && g < 200) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  const paras = [];
  let cur = null;
  let refMode = false; // 参考文献条目内：忽略行尾标点不断段
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.text;
    // 页眉/页脚过滤：arXiv 编号行、纯页码行
    if (/^arXiv\s*:\s*\d+/i.test(t) || (/^\d{1,3}$/.test(t) && t.length <= 3)) {
      continue;
    }
    const cls = classify(t);
    if (cls !== "P") {
      if (cur) {
        paras.push(cur);
        cur = null;
      }
      refMode = false;
      if (cls === "FIG") {
        // 图注合并：FIG 行后紧邻的描述行并入（直到大行距/非 P/超过 5 行）
        let text = t;
        let j = i + 1;
        let merged = 0;
        while (j < lines.length && merged < 5) {
          const nt = lines[j];
          const ncls = classify(nt.text);
          const gapBig =
            lineGap > 0 && line.y - nt.y > lineGap * 1.6;
          if (ncls === "P" && !gapBig) {
            text += " " + nt.text;
            merged++;
            j++;
          } else {
            break;
          }
        }
        i = j - 1;
        paras.push({ type: "FIG", text });
      } else {
        paras.push({ type: cls, text: t });
      }
      continue;
    }
    const prev = i > 0 ? lines[i - 1] : null;
    // y 上升 = 从页底换到页顶（换栏/翻页），必须断段；
    // 行距明显大于正常行距也是新段
    const columnBreak = prev !== null && prev.y - line.y < 0;
    const gapLarge = prev !== null && lineGap > 0 && prev.y - line.y > lineGap * 1.6;
    const isParaEnd = /[.!?;:，。；：？！”’"]$/.test(t);
    const hyphenBreak = /-\s*$/.test(t);
    const isRefStart = /^\[\d+\]/.test(t);

    if (isRefStart) {
      // 参考文献条目：强制新段并进入 refMode（内部忽略行尾标点，直到下一条 [N] 或大间隔）
      if (cur) paras.push(cur);
      cur = { type: "P", text: t };
      refMode = true;
    } else if (!cur) {
      cur = { type: "P", text: t };
      if (isParaEnd && !refMode) {
        paras.push(cur);
        cur = null;
      }
    } else if (columnBreak || gapLarge) {
      // 换栏/翻页或行距大 → 新段
      paras.push(cur);
      cur = { type: "P", text: t };
      refMode = false;
      if (isParaEnd && !refMode) {
        paras.push(cur);
        cur = null;
      }
    } else if (hyphenBreak) {
      // 连字符断词：去连字符直接拼接（truncation ar- + gument → argument）
      cur.text = cur.text.replace(/-\s*$/, "") + t;
    } else {
      cur.text += (cur.text.endsWith(" ") || t.startsWith(" ") ? "" : " ") + t;
      if (isParaEnd && !refMode) {
        paras.push(cur);
        cur = null;
      }
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

// 主抽取函数
// dataBytes: Uint8Array；onProgress(page,total)
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

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items);
    const paras = mergeParagraphs(lines);
    for (const blk of paras) {
      if (blk.type === "TABLE") {
        // 表格行保持独立，交给渲染端（LLM 会转成 markdown 表格）
        blocks.push(blk);
      } else {
        blocks.push(blk);
      }
    }
    if (onProgress) onProgress(p, doc.numPages);
  }

  try { await loadingTask.destroy(); } catch (e) {}
  return { blocks };
}
