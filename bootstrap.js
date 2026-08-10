// bootstrap.js
// Zotero 7/9 引导入口。负责注册菜单、偏好面板、动态加载 ESM 索引。
// 关键修复：Zotero 8+ 菜单系统重构，需使用 MenuManager API 或 #menu_ToolsPopup

var rootURI = "";

function startup({ id, version, rootURI: uri }) {
  rootURI = uri.endsWith("/") ? uri : uri + "/";

  // ====== 1. 注册偏好设置面板 ======
  try {
    if (typeof Zotero !== "undefined" && Zotero.PreferencePanes) {
      Zotero.PreferencePanes.register({
        pluginID: "zotero-paper-translator@lubinxtu.github.io",
        src: "preferences.xhtml",
        label: "论文翻译",
      });
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
      Zotero.debug("paper-translator: 模块加载成功，开始安装菜单");
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

// ====== 菜单安装（兼容 Zotero 7/8/9）======
function installMenus() {
  const win = Zotero.getMainWindow();
  if (!win || !win.document) { setTimeout(installMenus, 500); return; }
  const doc = win.document;

  // ---- 策略 A: Zotero 8+ MenuManager API ----
  if (typeof Zotero.MenuManager !== "undefined" && Zotero.MenuManager.registerMenu) {
    try {
      // 加载 Fluent 本地化文件
      try {
        if (win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
          win.MozXULElement.insertFTLIfNeeded("paper-translator.ftl");
        }
      } catch (ftlErr) {
        Zotero.debug("paper-translator: FTL 加载失败（非致命） - " + ftlErr);
      }
      // 工具菜单 → 翻译入口
      Zotero.MenuManager.registerMenu({
        menuType: "menuitem",
        target: "main/menubar/tools",
        l10nID: "zpt-menu-translate",
        onCommand: () => safeRun(),
        menuID: "zpt-menu-tools",
        pluginID: "zotero-paper-translator@lubinxtu.github.io",
      });
      // 工具菜单 → 设置入口
      Zotero.MenuManager.registerMenu({
        menuType: "menuitem",
        target: "main/menubar/tools",
        l10nID: "zpt-menu-prefs",
        onCommand: () => { try { if (Zotero.PaperTranslator.showPrefs) Zotero.PaperTranslator.showPrefs(); } catch(e){} },
        menuID: "zpt-menu-prefs",
        pluginID: "zotero-paper-translator@lubinxtu.github.io",
      });
      // 条目右键菜单 → 翻译入口
      Zotero.MenuManager.registerMenu({
        menuType: "menuitem",
        target: "main/library/item",
        l10nID: "zpt-item-translate",
        onCommand: () => safeRun(),
        menuID: "zpt-item-menu",
        pluginID: "zotero-paper-translator@lubinxtu.github.io",
      });
      Zotero.debug("paper-translator: 使用 MenuManager API 注册菜单成功");
      return; // 成功则不需要 fallback
    } catch (e) {
      Zotero.debug("paper-translator: MenuManager API 失败，回退到 DOM 操作 - " + e);
    }
  }

  // ---- 策略 B: Legacy DOM 操作（Zotero 7 或 MenuManager 失败时）----
  Zotero.debug("paper-translator: 使用 Legacy DOM 方式安装菜单");

  // 1) 条目列表右键菜单
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu && !doc.getElementById("zpt-menu-item")) {
    const mi = doc.createXULElement("menuitem");
    mi.id = "zpt-menu-item";
    mi.label = "翻译为中文";
    mi.addEventListener("command", () => safeRun());
    itemMenu.insertBefore(mi, itemMenu.firstChild);
    Zotero.debug("paper-translator: 右键菜单已添加");
  }

  // 2) 工具菜单 — Zotero 7/8/9 的正确 ID 是 #menu_ToolsPopup（大写 T）
  const toolsPopup = doc.getElementById("menu_ToolsPopup");
  if (toolsPopup) {
    if (!doc.getElementById("zpt-menu-tools")) {
      const mi = doc.createXULElement("menuitem");
      mi.id = "zpt-menu-tools";
      mi.label = "论文翻译：翻译选中 PDF";
      mi.addEventListener("command", () => safeRun());
      toolsPopup.appendChild(mi);
      Zotero.debug("paper-translator: 工具菜单(翻译)已添加");
    }
    if (!doc.getElementById("zpt-menu-prefs")) {
      const mi = doc.createXULElement("menuitem");
      mi.id = "zpt-menu-prefs";
      mi.label = "论文翻译：设置 API Key";
      mi.addEventListener("command", () => {
        try { if (Zotero.PaperTranslator && Zotero.PaperTranslator.showPrefs) Zotero.PaperTranslator.showPrefs(); }
        catch (e) { Zotero.logError(e); }
      });
      toolsPopup.appendChild(mi);
      Zotero.debug("paper-translator: 工具菜单(设置)已添加");
    }
  } else {
    Zotero.debug("paper-translator: 未找到 #menu_ToolsPopup，工具菜单无法添加");
  }

  win.addEventListener("load", () => installMenus(), { once: true });
}

function removeMenus() {
  try {
    // 尝试 MenuManager 注销
    if (typeof Zotero.MenuManager !== "undefined" && Zotero.MenuManager.unregisterMenu) {
      try {
        Zotero.MenuManager.unregisterMenu("zpt-menu-tools");
        Zotero.MenuManager.unregisterMenu("zpt-menu-prefs");
        Zotero.MenuManager.unregisterMenu("zpt-item-menu");
      } catch (e) {}
    }
    // DOM 清理
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
