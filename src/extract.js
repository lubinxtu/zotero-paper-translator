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

// ====== 双栏检测（行级）======
// 先按 y 聚合出"原始行"（记录行内 minX/maxX），再用行起点 x 做 k-means(k=2)。
// 行级而非 item 级：pdfjs 的 item.width 是单个词宽度，无法判断整行是否跨栏；
// 行级 maxX-minX 才是真正的行宽（页眉/单栏摘要/标题等跨栏行宽度接近页宽）。
// 两轮聚类：先粗分，过滤跨栏宽行后精调分栏线，避免跨栏行拉偏 splitX。
function kmeans2(xs) {
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
  return { c1, c2, span };
}

function detectTwoColumns(rows) {
  if (rows.length < 8) return null;
  const xs = rows.map((r) => r.minX);
  let r = kmeans2(xs);
  if (!r) return null;
  let { c1, c2, span } = r;
  let splitX = (c1 + c2) / 2;

  // 第二轮：过滤跨栏宽行（行宽 ≥ 页宽 30% 且横跨中线）后精调分栏线
  const filtered = rows.filter(
    (r) => !(r.minX < splitX && r.maxX > splitX && r.maxX - r.minX > span * 0.3)
  );
  if (filtered.length >= 6) {
    const r2 = kmeans2(filtered.map((r) => r.minX));
    if (r2) {
      c1 = r2.c1;
      c2 = r2.c2;
      span = r2.span;
      splitX = (c1 + c2) / 2;
    } else {
        }
  }

  const gap = Math.abs(c1 - c2);
  const leftCount = xs.filter((x) => x <= splitX).length;
  const rightCount = xs.length - leftCount;
  if (gap < span * 0.25) return null;
  if (leftCount >= 3 && rightCount >= 3) return { splitX, span };
  // 某一栏内容很少（混合布局页）时，用强信号确认：同一 y 高度存在 x 差距大的行
  if (hasSameRowColumns(rows, splitX, span)) return { splitX, span };
  return null;
}

// 强信号：同一 y（±2 容差）存在横跨 splitX 两侧、x 极差大的行 → 双栏
function hasSameRowColumns(rows, splitX, span) {
  const byY = new Map();
  for (const r of rows) {
    const key = Math.round(r.y / 4);
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(r);
  }
  let hits = 0;
  for (const group of byY.values()) {
    if (group.length < 2) continue;
    const minX = Math.min(...group.map((r) => r.minX));
    const maxX = Math.max(...group.map((r) => r.maxX));
    if (maxX - minX > span * 0.3 && minX < splitX && maxX > splitX) hits++;
  }
  return hits >= 2;
}

// 按 y 聚合原始行；同一 y 组内 x 跨度大（左右栏同行）时按最大间隙拆分成两个子行。
// 跨栏行（标题/摘要/页眉）item 连续、无大间隙，不会被误拆。
function buildRawLines(items) {
  const sorted = items.slice().sort((a, b) => {
    const d = b.transform[5] - a.transform[5];
    if (Math.abs(d) > 2) return d;
    return a.transform[4] - b.transform[4];
  });
  const groups = [];
  let cur = null;
  let lastY = null;
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) > 2) {
      cur = { y, items: [] };
      groups.push(cur);
      lastY = y;
    }
    cur.items.push(it);
  }
  const allXs = items.map((it) => it.transform[4]);
  const span = Math.max(...allXs) - Math.min(...allXs);

  const rows = [];
  for (const g of groups) {
    const its = g.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
    const first = its[0].transform[4];
    const last = its[its.length - 1].transform[4] + (its[its.length - 1].width || 0);
    const rowSpan = last - first;
    // [N] 编号强信号：同一 y 组内出现两个不同编号 → 参考文献双栏，在第二个编号处拆
    const numIdxs = [];
    its.forEach((it, idx) => {
      if (/^\[\d+\]/.test(it.str.trim())) numIdxs.push(idx);
    });
    if (numIdxs.length >= 2) {
      rows.push(makeRow(g.y, its.slice(0, numIdxs[1])));
      rows.push(makeRow(g.y, its.slice(numIdxs[1])));
      continue;
    }
    // 组内跨度大且存在明显间隙 → 拆成左右两行
    if (its.length >= 4 && rowSpan > span * 0.35) {
      let maxGap = 0;
      let splitAt = -1;
      for (let i = 1; i < its.length; i++) {
        const gap =
          its[i].transform[4] - (its[i - 1].transform[4] + (its[i - 1].width || 0));
        if (gap > maxGap) {
          maxGap = gap;
          splitAt = i;
        }
      }
      // 两栏行常有 x 重叠（左栏长行延伸到右栏起点附近），用绝对间隙阈值更稳
      if (maxGap > 40) {
        rows.push(makeRow(g.y, its.slice(0, splitAt)));
        rows.push(makeRow(g.y, its.slice(splitAt)));
        continue;
      }
    }
    rows.push(makeRow(g.y, its));
  }
  return rows;
}

function makeRow(y, items) {
  const minX = items[0].transform[4];
  let maxX = minX;
  for (const it of items) {
    const x2 = it.transform[4] + (it.width || 0);
    if (x2 > maxX) maxX = x2;
  }
  return { y, minX, maxX, items };
}

// 行内按 x 拼接文本 → [{y, x, text}]
function joinRow(row) {
  const its = row.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
  let s = "";
  let prevX = null;
  for (const t of its) {
    const x = t.transform[4];
    if (prevX !== null && x - prevX > 2 && s && !s.endsWith(" ")) s += " ";
    s += t.str;
    prevX = x + (t.width || 0);
  }
  return { y: row.y, x: row.minX, text: s.replace(/\s+/g, " ").trim() };
}

// 分栏组装：双栏页面按「左栏（含跨栏的页眉/页脚/宽标题，按 y 插入）→ 右栏」输出
function groupIntoLines(items) {
  const rows = buildRawLines(items);
  const twoCol = detectTwoColumns(rows);
  if (!twoCol) {
    return rows.map(joinRow).filter((l) => l.text.length > 0);
  }
  const splitX = twoCol.splitX;
  const span = twoCol.span;
  const isCross = (r) =>
    r.minX <= splitX && r.maxX > splitX && r.maxX - r.minX > span * 0.3;
  const cross = rows.filter(isCross);
  const left = rows.filter((r) => r.minX <= splitX && !isCross(r));
  const right = rows.filter((r) => r.minX > splitX);
  const leftLines = left.map(joinRow);
  const crossLines = cross.map(joinRow);
  const rightLines = right.map(joinRow);
  // 跨栏行（页眉/页脚/跨栏标题）按 y 与左栏行混合排序：页眉在页首、页脚在页尾
  const leftMerged = [...leftLines, ...crossLines].sort((a, b) => b.y - a.y);
  return [...leftMerged, ...rightLines].filter((l) => l.text.length > 0);
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
  let lastLine = null; // 上一个处理过的行（跳过页眉/页码行后仍保持正确）
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
      lastLine = line;
      continue;
    }
    const prev = lastLine;
    // 断段条件：
    // 1. y 上升 = 从页底换到页顶（换栏/翻页）
    // 2. 行距明显大于正常行距（段间距）
    // 3. 行首缩进（x 明显大于上一行，英文论文段首行通常缩进）
    // 4. 列表项开头（•、–、-）
    // 注意：行尾标点【不再】作为断段依据 —— 英文排版每行常在句号处结束，
    //       用它断段会把同一自然段拆成多个碎片（用户反馈"段落不分明"的根因）。
    const columnBreak = prev !== null && prev.y - line.y < 0;
    const gapLarge = prev !== null && lineGap > 0 && prev.y - line.y > lineGap * 1.6;
    const indented = prev !== null && line.x - prev.x > 8;
    const listStart = /^[•–\-–]\s/.test(t) || /^-\s/.test(t);
    const hyphenBreak = /-\s*$/.test(t);
    const isRefStart = /^\[\d+\]/.test(t);

    if (isRefStart) {
      // 参考文献条目：强制新段并进入 refMode（内部忽略行尾标点，直到下一条 [N] 或大间隔）
      if (cur) paras.push(cur);
      cur = { type: "P", text: t };
      refMode = true;
    } else if (!cur) {
      cur = { type: "P", text: t };
    } else if (columnBreak || gapLarge || indented || listStart) {
      // 新段
      paras.push(cur);
      cur = { type: "P", text: t };
      refMode = false;
    } else if (hyphenBreak) {
      // 连字符断词：去连字符直接拼接（truncation ar- + gument → argument）
      cur.text = cur.text.replace(/-\s*$/, "") + t;
    } else {
      cur.text += (cur.text.endsWith(" ") || t.startsWith(" ") ? "" : " ") + t;
    }
    lastLine = line;
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
