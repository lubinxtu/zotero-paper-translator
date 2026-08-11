// translate.js
// 调用 OpenAI 兼容的 Chat Completions 接口逐块翻译。
// 支持自定义端点 / 模型 / 术语表，含重试与 429 退避。

import { buildSystemPrompt, BLOCK } from "./glossary.js";

const TRANSLATABLE = new Set(["H1", "H2", "H3", "P", "FIG", "TABLE"]);

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
// 并发数为 3：长 PDF 提速明显，同时避免一次性打爆 API 限流；输出保持原顺序。
// onProgress(done,total,type)
const MAX_CONCURRENCY = 3;

export async function translateBlocks(blocks, opts, onProgress) {
  const system = buildSystemPrompt(opts.customGlossary || "");
  const total = blocks.length;
  const out = new Array(total);
  let done = 0;
  let idx = 0;

  const worker = async () => {
    while (idx < total) {
      const i = idx++;
      const blk = blocks[i];
      if (!TRANSLATABLE.has(blk.type)) {
        out[i] = blk;
      } else {
        const userContent = `${blockMarker(blk.type)} ${blk.text}`;
        try {
          const translated = await callLLM(system, userContent, opts);
          out[i] = { type: blk.type, text: stripMarker(translated, blk.type) };
        } catch (e) {
          // 翻译失败时保留原文，避免整篇失败
          out[i] = { type: blk.type, text: blk.text };
          out._errors = (out._errors || []).concat([`[${blk.type}] ${e.message}`]);
        }
      }
      done++;
      if (onProgress) onProgress(done, total, blk.type);
    }
  };

  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
  return out;
}

function stripMarker(text, type) {
  // 去掉行首可能的结构标记（模型可能改写/添加任意标记，如 [P]、[TABLE]、[H2]）
  // 以及 markdown 标题符号（## 、### 等）
  return text
    .replace(/^\s*\[(?:P|H1|H2|H3|TABLE|FIG|EQN)\]\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .trim();
}
