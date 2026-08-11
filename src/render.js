// render.js
// 将翻译后的结构块渲染为带 MathJax 的 HTML 文档。
// 该 HTML 作为 Zotero 子附件保存；用户可在浏览器中"打印 → 另存为 PDF"。

const MATHJAX_CDN = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 极简 Markdown 表格解析（| a | b |）
function renderTable(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return `<pre>${escapeHtml(text)}</pre>`;
  const parseRow = (l) =>
    l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);
  // 没有任何数据单元格的空表（抽取碎片导致）降级为等宽文本，避免渲染空白表格
  const hasData = rows.some((r) => r.some((c) => c !== ""));
  if (!hasData) return `<pre>${escapeHtml(text)}</pre>`;
  let html = '<table class="zt-table"><thead><tr>';
  for (const h of headers) html += `<th>${escapeHtml(h)}</th>`;
  html += "</tr></thead><tbody>";
  for (const r of rows) {
    html += "<tr>";
    for (const c of r) html += `<td>${escapeHtml(c)}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

export function renderHTML(blocks, meta = {}) {
  const title = meta.title || "翻译文档";
  const authors = meta.authors || "";
  let body = "";

  for (const blk of blocks) {
    // 跳过空块（翻译失败/空结果兜底后不应产生空段落）
    if (!blk || !blk.text || !blk.text.trim()) continue;
    switch (blk.type) {
      case "H1":
        body += `<h1>${escapeHtml(blk.text)}</h1>\n`;
        break;
      case "H2":
        body += `<h2>${escapeHtml(blk.text)}</h2>\n`;
        break;
      case "H3":
        body += `<h3>${escapeHtml(blk.text)}</h3>\n`;
        break;
      case "TABLE":
        body += renderTable(blk.text) + "\n";
        break;
      case "FIG":
        body += `<p class="zt-fig">${escapeHtml(blk.text)}</p>\n`;
        break;
      case "EQUATION_NOTE":
        body += `<p class="zt-eqn">${escapeHtml(blk.text)}</p>\n`;
        break;
      default: // P
        body += `<p>${escapeHtml(blk.text)}</p>\n`;
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}（中译）</title>
<script>
  MathJax = { tex: { inlineMath: [['$','$'],['\\\\(','\\\\)']], displayMath: [['$$','$$'],['\\\\[','\\\\]']] }, svg: { fontCache: 'global' } };
</script>
<script src="${MATHJAX_CDN}" id="MathJax-script" async></script>
<style>
  :root { --serif: "Songti SC","SimSun","Noto Serif SC","Source Han Serif SC",serif; }
  body { font-family: var(--serif); line-height: 1.8; max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; color: #1a1a1a; }
  h1 { font-size: 1.6rem; text-align: center; margin-bottom: .3rem; }
  h2 { font-size: 1.25rem; border-bottom: 1px solid #ccc; padding-bottom: .2rem; margin-top: 1.6rem; }
  h3 { font-size: 1.1rem; margin-top: 1.2rem; }
  p { text-align: justify; margin: .6rem 0; }
  .zt-fig { font-size: .92rem; color: #444; }
  .zt-eqn { font-style: italic; }
  .zt-table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .92rem; }
  .zt-table th, .zt-table td { border: 1px solid #999; padding: .4rem .6rem; text-align: center; }
  .zt-table th { background: #f0f0f0; }
  .zt-meta { text-align: center; color: #555; margin-bottom: 1.5rem; }
  #zt-print { position: fixed; top: 12px; right: 12px; padding: 8px 14px; background: #185fa5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: .9rem; }
  @media print { #zt-print { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<button id="zt-print" onclick="window.print()">打印 / 另存为 PDF</button>
<h1>${escapeHtml(title)}</h1>
${authors ? `<div class="zt-meta">${escapeHtml(authors)}</div>` : ""}
<hr>
${body}
</body>
</html>`;
}

// 纯文本回退（无公式渲染需求时使用）
export function renderPlainText(blocks) {
  return blocks.map((b) => b.text).join("\n\n");
}
