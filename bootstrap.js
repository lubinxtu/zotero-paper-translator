// bootstrap.js
// Zotero 7/9 引导入口。负责注册菜单、偏好面板、动态加载 ESM 索引。

var rootURI = "";

function startup({ id, version, rootURI: uri }) {
  rootURI = uri.endsWith("/") ? uri : uri + "/";

  // ====== 1. 注册偏好设置面板（Zotero 7+ 标准 API）======
  try {
    if (typeof Zotero !== "undefined" && Zotero.PreferencePanes) {
      Zotero.PreferencePanes.register({
        pluginID: "zotero-paper-translator@lubinxtu.github.io",
        src: "preferences.xhtml",
        label: "论文翻译",
      });
      Zotero.debug("paper-translator: 偏好面板已注册");
    } else {
      Zotero.debug("paper-translator: Zotero.PreferencePanes 不可用");
    }
  } catch (e) {
    Zotero.debug("paper-translator: 偏好面板注册异常 - " + e);
  }

  // ====== 2. 动态加载 ESM 索引 ======
  import(rootURI + "index.js")
    .then((mod) => {
      Zotero.PaperTranslator = {
        translateSelected: mod.translateSelected,
        showPrefs: mod.showPrefs,
      };
      installMenus();
      Zotero.debug("paper-translator: 模块加载成功");
    })
    .catch((e) => {
      Zotero.logError("paper-translator 加载失败: " + e);
    });
}

function shutdown({ id }) {
  removeMenus();
  if (Zotero.PaperTranslator) delete Zotero.PaperTranslator;
  try { Components.utils.unload(rootURI + "index.js"); } catch (e) {}
}

function install() {}
function uninstall() {}

// ====== 菜单安装 ======
function installMenus() {
  const win = Zotero.getMainWindow();
  if (!win || !win.document) { setTimeout(installMenus, 500); return; }
  const doc = win.document;

  // 1) 条目列表右键菜单
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu && !doc.getElementById("zpt-menu-item")) {
    const mi = doc.createXULElement("menuitem");
    mi.id = "zpt-menu-item";
    mi.label = "翻译为中文";
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

  // 3) 工具菜单 → 设置（备用入口）
  if (tools && !doc.getElementById("zpt-menu-prefs")) {
    const mp = tools.menupopup || tools;
    const mi = doc.createXULElement("menuitem");
    mi.id = "zpt-menu-prefs";
    mi.label = "论文翻译：设置 API Key";
    mi.addEventListener("command", () => {
      try { if (Zotero.PaperTranslator && Zotero.PaperTranslator.showPrefs) Zotero.PaperTranslator.showPrefs(); }
      catch (e) { Zotero.logError(e); }
    });
    mp.appendChild(mi);
  }

  win.addEventListener("load", () => installMenus(), { once: true });
}

function removeMenus() {
  try {
    const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
    for (const win of wins) {
      if (!win || !win.document) continue;
      ["zpt-menu-item", "zpt-menu-tools", "zpt-menu-prefs"].forEach(id => {
        const el = win.document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    }
  } catch (e) {}
}

function safeRun() {
  try {
    if (Zotero.PaperTranslator && Zotero.PaperTranslator.translateSelected)
      Zotero.PaperTranslator.translateSelected();
    else
      Zotero.alert(null, "论文翻译", "插件尚未加载完成，请稍后重试。");
  } catch (e) {
    Zotero.logError("paper-translator 执行失败: " + e);
  }
}
