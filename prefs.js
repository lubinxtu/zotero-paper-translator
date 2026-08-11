// prefs.js
// 注册插件默认偏好（Zotero 启动时由 plugins.js 的 setDefaultPrefs 加载，
// 通过 target 对象的 pref() 写入默认分支）。
// 说明：数值类（temperature / maxRetries）以字符串注册，避免 setIntPref 丢弃小数；
// 运行时 prefs.js 的 loadPrefs() 会做 Number() 归一化。
pref("extensions.zotero-paper-translator.apiKey", "");
pref("extensions.zotero-paper-translator.baseURL", "https://api.openai.com/v1");
pref("extensions.zotero-paper-translator.model", "gpt-4o-mini");
pref("extensions.zotero-paper-translator.temperature", "0.2");
pref("extensions.zotero-paper-translator.maxRetries", "3");
pref("extensions.zotero-paper-translator.outputMode", "html");
pref("extensions.zotero-paper-translator.customGlossary", "");
