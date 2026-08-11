// translate.js
// 调用 OpenAI 兼容的 Chat Completions 接口逐块翻译。
// 支持自定义端点 / 模型 / 术语表，含重试与 429 退避。

import { buildSystemPrompt, BLOCK } from "./glossary.js";

// 可翻译块类型。表格行（TABLE）不送 LLM：模型会把表格当文本乱翻（如数字行加"表"字），
// 且表格数值本就应原样保留。
const TRANSLATABLE = new Set(["H1", "H2", "H3", "P", "FIG"]);

function blockMarker(type) {
  return BLOCK[type] || "[P]";
}

// 单次 LLM 调用，带重试
// dropTemperature：推理模型（如 Kimi k2 系列）只允许 temperature=1，
// 400 报 "invalid temperature" 时自动去掉该参数重试一次
async function callLLM(systemPrompt, userContent, opts, attempt = 0, dropTemperature = false) {
  const url = (opts.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: opts.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    stream: false,
  };
  if (!dropTemperature && opts.temperature != null) {
    body.temperature = opts.temperature;
  }
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (attempt < (opts.maxRetries || 3)) {
      await sleep(800 * (attempt + 1));
      return callLLM(systemPrompt, userContent, opts, attempt + 1, dropTemperature);
    }
    throw new Error("网络请求失败: " + e.message);
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || (attempt + 1) * 3);
    if (attempt < (opts.maxRetries || 3)) {
      await sleep(retryAfter * 1000);
      return callLLM(systemPrompt, userContent, opts, attempt + 1, dropTemperature);
    }
    throw new Error("触发限流且重试耗尽 (429)");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // 推理模型不接受 temperature（如 Kimi k2 系列只允许 1）→ 去掉该参数重试
    if (!dropTemperature && res.status === 400 && /temperature/i.test(txt)) {
      Zotero.debug("paper-translator: API 不接受 temperature，降级重试 - " + txt.slice(0, 120));
      return callLLM(systemPrompt, userContent, opts, attempt, true);
    }
    throw new Error(`API 错误 ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 逐块翻译。blocks: [{type,text}]；返回同结构，text 为译文。
//
// 策略：
// 1. 连续可翻译块打包成批（[B0]/[B1]… 标记一次调用），让模型看到上下文，
//    显著减少碎片幻觉（此前每块独立翻译，残片输入会诱发模型编造内容）。
// 2. 参考文献条目（[N] 开头）、公式/符号残片、表格行（TABLE）不送 LLM，直接保留原文
//    （参考文献本就要求英文原文；残片送模型只会换来幻觉；表格行送模型会被当文本乱翻）。
// 3. 批量失败或输出格式不匹配时，自动回退为逐块翻译。
// 4. 去重保护：LLM 偶发把同一译文重复标记给相邻块时，后一块恢复原文。
// onProgress(done,total,type)
const MAX_BATCH = 8;         // 每批最多块数（大批次给模型更多上下文）
const MAX_CONCURRENCY = 2;   // 批间并发

// 参考文献条目（[N] 开头）→ 保留英文原文，不送 LLM
function isReference(text) {
  return /^\[\d+\]/.test(text.trim());
}

// 公式/符号残片 → 保留原文不翻译（公式本来就不该翻译，且残片会诱发模型幻觉/乱译）
const MATH_SYMS = /[\^_$\\{}|±≈×÷−√∫∂∑∏∈ΩλΣΓΔγμνπθℓ⟨⟩†∗ˆ′~]/;

function isFragment(text) {
  const t = text.trim();
  if (!t) return true;
  const symCount = (t.match(MATH_SYMS) || []).length;
  // 剔除数字与公式编号（如 (1.1)、2.3）后再判断句子结尾，避免编号里的句点误判
  const noNums = t.replace(/\(?\d+(?:\.\d+)*\)?/g, "");
  const hasSentenceEnd = /[.!?]/.test(noNums);
  // 数学符号密集 → 公式行，保留原文
  if (symCount >= 3) return true;
  // 无空格连续符号串
  if (t.length >= 12 && !/\s/.test(t)) return true;
  // 含公式符号的短行（无句号，不是完整句子）→ 保留
  if (t.length <= 80 && symCount >= 1 && !hasSentenceEnd) return true;
  // 数字密集且无句号（公式/表格残片，如 "2 Npair 2 12 N = N + 1) = N"）
  const numTokens = (t.match(/\d+/g) || []).length;
  if (numTokens >= 3 && !hasSentenceEnd) return true;
  return false;
}

// 译文清洗：中文译文里混入公式符号（≥2 个）→ 判定质量差，回退原文（宁可英文也不乱）
function isDirtyTranslation(text) {
  if (!/[\u4e00-\u9fff]/.test(text)) return false; // 无中文 → 不判定（英文原文/译文都干净）
  return (text.match(MATH_SYMS) || []).length >= 2;
}

export async function translateBlocks(blocks, opts, onProgress) {
  const system = buildSystemPrompt(opts.customGlossary || "");
  const total = blocks.length;
  const out = new Array(total);
  let done = 0;

  // 构造批：连续可翻译块打包；不可翻译/参考文献/残片直接保留
  const batches = [];
  let curBatch = [];
  const flush = () => {
    if (curBatch.length) {
      batches.push(curBatch);
      curBatch = [];
    }
  };
  for (let i = 0; i < total; i++) {
    const blk = blocks[i];
    if (!TRANSLATABLE.has(blk.type) || isReference(blk.text) || isFragment(blk.text)) {
      out[i] = blk;
      done++;
      if (onProgress) onProgress(done, total, blk.type);
      flush();
      continue;
    }
    if (curBatch.length >= MAX_BATCH) flush();
    curBatch.push({ pos: i, blk });
  }
  flush();

  let batchIdx = 0;
  const worker = async () => {
    while (batchIdx < batches.length) {
      const batch = batches[batchIdx++];
      const results = await translateBatch(system, batch, opts);
      for (const r of results) {
        const item = batch[r.idx];
        const blk = item.blk;
        if (r.ok) {
          const cleaned = stripMarker(r.text, blk.type);
          // 空结果或译文混入公式符号（中英混杂）→ 回退原文，保证输出干净
          if (!cleaned || isDirtyTranslation(cleaned)) {
            out[item.pos] = { type: blk.type, text: blk.text };
          } else {
            out[item.pos] = { type: blk.type, text: cleaned };
          }
        } else {
          out[item.pos] = { type: blk.type, text: blk.text };
          out._errors = (out._errors || []).concat([`[${blk.type}] ${r.error}`]);
        }
        done++;
        if (onProgress) onProgress(done, total, blk.type);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, batches.length) }, () => worker()));

  // 去重保护：LLM 偶发把同一译文重复标记给相邻块时，后一块恢复原文（宁可保留英文也不重复）
  for (let i = 1; i < total; i++) {
    if (
      out[i] && out[i - 1] &&
      out[i].text === out[i - 1].text &&
      blocks[i].text !== blocks[i - 1].text
    ) {
      out[i] = { type: blocks[i].type, text: blocks[i].text };
    }
  }
  return out;
}

// 翻译一批块；批量失败或输出无法解析时回退为逐块翻译
async function translateBatch(system, batch, opts) {
  const userContent = batch
    .map((b, i) => `[B${i}] ${blockMarker(b.blk.type)} ${b.blk.text}`)
    .join("\n");
  let translated;
  try {
    translated = await callLLM(system, userContent, opts);
  } catch (e) {
    return fallbackOneByOne(system, batch, opts);
  }
  const parsed = parseBatchOutput(translated, batch.length);
  if (!parsed) {
    return fallbackOneByOne(system, batch, opts);
  }
  return batch.map((b, i) => ({ idx: i, pos: b.pos, ok: true, text: parsed[i] }));
}

async function fallbackOneByOne(system, batch, opts) {
  return Promise.all(
    batch.map(async (b, i) => {
      try {
        return {
          idx: i,
          pos: b.pos,
          ok: true,
          text: await callLLM(system, `${blockMarker(b.blk.type)} ${b.blk.text}`, opts),
        };
      } catch (e) {
        return { idx: i, pos: b.pos, ok: false, error: e.message };
      }
    })
  );
}

// 解析 [B0] [B1] … 前缀的批输出；任一块缺失则返回 null
function parseBatchOutput(text, n) {
  const re = /\[B(\d+)\]\s*([\s\S]*?)(?=\[B\d+\]\s*|$)/g;
  const results = new Array(n);
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = Number(m[1]);
    if (idx >= 0 && idx < n) results[idx] = m[2].trim();
  }
  for (let i = 0; i < n; i++) {
    if (results[i] === undefined) return null;
  }
  return results;
}

function stripMarker(text, type) {
  // 去掉行首的结构标记与 markdown 标题符号，以及全文中残留的中英文结构标记
  // （模型可能改写/翻译标记，如 [P]、[TABLE]、[段落]、[图] 等）
  return text
    .replace(/^\s*\[(?:P|H1|H2|H3|TABLE|FIG|EQN|段落|表格|图|公式|标题)\]\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\[(?:P|H1|H2|H3|TABLE|FIG|EQN|段落|表格|图|公式|标题)\]/g, "")
    .trim();
}
