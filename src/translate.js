// translate.js
// 调用 OpenAI 兼容的 Chat Completions 接口逐块翻译。
// 支持自定义端点 / 模型 / 术语表，含重试与 429 退避。

import { buildSystemPrompt, BLOCK } from "./glossary.js";

const TRANSLATABLE = new Set(["H1", "H2", "H3", "P", "FIG", "TABLE"]);

function blockMarker(type) {
  return BLOCK[type] || "[P]";
}

// 单次 LLM 调用，带重试
async function callLLM(systemPrompt, userContent, opts, attempt = 0) {
  const url = (opts.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: opts.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: opts.temperature != null ? opts.temperature : 0.2,
    stream: false,
  };
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
      return callLLM(systemPrompt, userContent, opts, attempt + 1);
    }
    throw new Error("网络请求失败: " + e.message);
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || (attempt + 1) * 3);
    if (attempt < (opts.maxRetries || 3)) {
      await sleep(retryAfter * 1000);
      return callLLM(systemPrompt, userContent, opts, attempt + 1);
    }
    throw new Error("触发限流且重试耗尽 (429)");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API 错误 ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 逐块翻译。blocks: [{type,text}]；返回同结构，text 为译文。
// onProgress(done,total,type)
export async function translateBlocks(blocks, opts, onProgress) {
  const system = buildSystemPrompt(opts.customGlossary || "");
  const total = blocks.length;
  let done = 0;
  const out = [];
  for (const blk of blocks) {
    if (!TRANSLATABLE.has(blk.type)) {
      out.push(blk);
    } else {
      const userContent = `${blockMarker(blk.type)} ${blk.text}`;
      let translated = "";
      try {
        translated = await callLLM(system, userContent, opts);
        // 去掉模型可能回带的结构标记前缀
        translated = stripMarker(translated, blk.type);
      } catch (e) {
        // 翻译失败时保留原文，避免整篇失败
        translated = blk.text;
        out._errors = (out._errors || []).concat([`[${blk.type}] ${e.message}`]);
      }
      out.push({ type: blk.type, text: translated });
    }
    done++;
    if (onProgress) onProgress(done, total, blk.type);
  }
  return out;
}

function stripMarker(text, type) {
  const m = blockMarker(type);
  // 去掉行首可能的 "[P] " 之类标记
  return text.replace(new RegExp("^\\s*" + m.replace(/[\[\]]/g, "\\$&") + "\\s*"), "").trim();
}
