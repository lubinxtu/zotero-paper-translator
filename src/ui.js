// ui.js
// 轻量进度提示与错误汇报，基于 Zotero.ProgressWindow（不可用则降级为 alert）。

export function createProgress(label = "论文翻译") {
  let pw = null;
  let item = null;
  try {
    if (typeof Zotero !== "undefined" && Zotero.ProgressWindow) {
      pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline(label);
      item = new pw.ItemProgress("chrome://zotero/skin/treeitem-attachment.png", label);
      pw.show();
    }
  } catch (e) {
    pw = null;
  }
  return {
    setText(t) {
      try { if (item) item.setText(t); } catch (e) {}
    },
    setProgress(pct) {
      try { if (item) item.setProgress(Math.max(0, Math.min(100, pct))); } catch (e) {}
    },
    finish(success = true, text = "") {
      try {
        if (item) {
          item.setProgress(100);
          if (text) item.setText(text);
        }
        if (pw) pw.startCloseTimer(success ? 3000 : 8000);
      } catch (e) {}
    },
    error(msg) {
      try { if (pw) pw.startCloseTimer(8000); } catch (e) {}
      if (typeof Zotero !== "undefined" && Zotero.alert) {
        Zotero.alert(null, "论文翻译出错", String(msg));
      } else {
        console.error(msg);
      }
    },
  };
}

export function alert(title, msg) {
  if (typeof Zotero !== "undefined" && Zotero.alert) Zotero.alert(null, title, msg);
  else console.log(`[${title}] ${msg}`);
}
