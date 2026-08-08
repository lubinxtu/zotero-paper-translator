// bootstrap.js
// Zotero 7 引导入口（经典脚本）。负责注册菜单并动态加载打包后的 ESM 索引。
// 参考：Mozilla 引导式扩展（bootstrap.js）规范 + Zotero 7 API。

var rootURI = "";

function startup({ id, version, rootURI: uri }) {
  rootURI = uri.endsWith("/") ? uri : uri + "/";
  // 动态加载 ESM 索引
  import(rootURI + "index.js")
    .then((mod) => {
      Zotero.PaperTranslator = { translateSelected: mod.translateSelected };
      installMenus();
    })
    .catch((e) => {
      Zotero.logError("paper-translator 加载失败: " + e);
    });
}

function shutdown({ id }) {
  removeMenus();
  if (Zotero.PaperTranslator) delete Zotero.PaperTranslator;
  // 卸载已加载的 ESM 模块（如有）
  try { Components.utils.unload(rootURI + "index.js"); } catch (e) {}
}

function install() {}
function uninstall() {}

// 等待 Zotero 主窗口中的条目右键菜单出现，然后注入菜单项
function installMenus() {
  const win = Zotero.getMainWindow();
  if (!win || !win.document) { setTimeout(installMenus, 500); return; }
  const doc = win.document;

  // 1) 条目列表右键菜单
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu && !doc.getElementById("zpt-menu-item")) {
    const mi = doc.createXULElement("menuitem");
    mi.id = "zpt-menu-item";
    mi.label = "翻译为 PDF（中译）";
    mi.addEventListener("command", () => safeRun());
    itemMenu.insertBefore(mi, itemMenu.firstChild);
  }

  // 2) 工具菜单
  const tools = doc.getElementById("menu_tools");
  if (tools && !doc.getElementById("zpt-menu-tools")) {
    const mp = tools.menupopup || tools;
    const mi = doc.createXULElement("menuitem");
    mi.id = "zpt-menu-tools";
    mi.label = "论文翻译：翻译选中 PDF";
    mi.addEventListener("command", () => safeRun());
    mp.appendChild(mi);
  }

  // 处理后续打开的窗口
  win.addEventListener("load", () => installMenus(), { once: true });
}

function removeMenus() {
  try {
    const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
    for (const win of wins) {
      if (!win || !win.document) continue;
      const a = win.document.getElementById("zpt-menu-item");
      if (a && a.parentNode) a.parentNode.removeChild(a);
      const b = win.document.getElementById("zpt-menu-tools");
      if (b && b.parentNode) b.parentNode.removeChild(b);
    }
  } catch (e) {}
}

function safeRun() {
  try {
    if (Zotero.PaperTranslator) Zotero.PaperTranslator.translateSelected();
  } catch (e) {
    Zotero.logError("paper-translator 执行失败: " + e);
  }
}
