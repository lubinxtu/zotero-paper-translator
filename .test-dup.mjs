import { translateBlocks } from "./src/translate.js";
import { readFileSync } from "fs";
globalThis.Zotero = { debug: () => {}, logError: () => {} };
const key = readFileSync("C:/Users/15617/AppData/Roaming/Zotero/Zotero/Profiles/bi16r758.default/prefs.js", "utf8")
  .match(/user_pref\("extensions\.zotero-paper-translator\.apiKey", "([^"]*)"\)/)[1];
const opts = { apiKey: key, baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-128k", temperature: 0.2, maxRetries: 2 };

// 复现用户场景：blocks[25]-[29] 附近（含 suggested 句）
const blocks = [
  { type: "P", text: "using the SpH basis, the appropriate reconstruction multipole need not coincide with the maximum ℓ. In fact, using a higher ℓ along with appropriate regularization scheme can yield a finer point-spread function." },
  { type: "P", text: "Similarly, recent work [16] demonstrated that choosing the wrong ℓ can lead to excess leakage from unmodeled but informative angular scales." },
  { type: "P", text: "It has been suggested that the Fisher matrix formalism developed in [8, 9] can mitigate issues such as small-scale leakage and provide advantage over SpH representations [7]. Here, we clarify the origin of these differences." },
  { type: "P", text: "The Fisher matrix is the fundamental object that determines anisotropy information in any basis, including pixel and SpH bases." },
];
const out = await translateBlocks(blocks, opts, () => {});
const texts = out.map(b => b.text);
console.log("块数:", texts.length);
console.log("唯一译文数:", new Set(texts).size);
for (let i = 0; i < texts.length; i++) console.log(`[${i}] ${texts[i].slice(0, 100)}`);
