// prefs.js
// 偏好设置封装。键名统一挂在 extensions.zotero-paper-translator. 下。
// 用户在 Zotero 首选项 → 论文翻译 面板中填写。

const BRANCH = "extensions.zotero-paper-translator.";

const DEFAULTS = {
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  customGlossary: "",
  temperature: 0.2,
  maxRetries: 3,
  outputMode: "html", // html | pdf(打印)
};

function get(key, def) {
  try {
    if (typeof Zotero === "undefined" || !Zotero.Prefs) return def;
    const v = Zotero.Prefs.get(BRANCH + key, true);
    return v === undefined || v === null || v === "" ? def : v;
  } catch (e) {
    return def;
  }
}

function set(key, val) {
  try {
    if (typeof Zotero !== "undefined" && Zotero.Prefs) {
      Zotero.Prefs.set(BRANCH + key, val, true);
    }
  } catch (e) {
    /* ignore */
  }
}

export function loadPrefs() {
  const p = {};
  for (const k of Object.keys(DEFAULTS)) {
    p[k] = get(k, DEFAULTS[k]);
  }
  // 数值字段校正
  p.temperature = Number(p.temperature) || DEFAULTS.temperature;
  p.maxRetries = Number(p.maxRetries) || DEFAULTS.maxRetries;
  return p;
}

export function savePrefs(p) {
  for (const k of Object.keys(DEFAULTS)) {
    if (k in p) set(k, p[k]);
  }
}

export { BRANCH, DEFAULTS };
