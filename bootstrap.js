// bootstrap.js
// Zotero 7/9 引导入口。负责注册菜单、偏好面板、加载主模块。
//
// 关键兼容性结论（在 Zotero 9.0.6 上实测/核对官方源码）：
// 1. 插件 bootstrap 运行在无 DOM 的 Cu.Sandbox 里，**动态 import() 不可用**
//    （抛 "No ScriptLoader found for the current context"），
//    必须用 Services.scriptloader.loadSubScript(rootURI + "index.js", ctx) 加载主模块。
// 2. MenuManager 正确签名：registerMenu({ menuID, pluginID, target, menus:[MenuData] })
//    —— menuType / l10nID / onCommand 放在 menus 数组元素上，menus 必填；
//    注册失败时 registerMenu 静默返回 false（不抛异常），必须检查返回值。
// 3. FTL 注入所有主窗口（含以后新开的窗口）；MenuManager 本身不加载插件 FTL。
// 4. shutdown 时清理 FTL link，避免禁用/更新后残留失效的本地化引用。

var rootURI = "";
var _windowListener = null;

const PLUGIN_ID = "zotero-paper-translator@lubinxtu.github.io";
const FTL_FILE = "paper-translator.ftl";

function startup({ id, version, rootURI: uri }) {
  rootURI = uri.endsWith("/") ? uri : uri + "/";

  // ====== 1. 注册偏好设置面板 ======
  try {
    if (typeof Zotero !== "undefined" && Zotero.PreferencePanes) {
      Zotero.PreferencePanes.register({
        pluginID: PLUGIN_ID,
        src: "preferences.xhtml",
        label: "论文翻译",
        // 固定 id：菜单「设置 API Key」用它直接打开该面板
        id: "zpt-prefpane",
      });
    }
  } catch (e) {
    Zotero.debug("paper-translator: 偏好面板注册异常 - " + e);
  }

  // ====== 2. 加载主模块（IIFE bundle）======
  try {
    const ctx = { rootURI };
    ctx._globalThis = ctx;
    Services.scriptloader.loadSubScript(rootURI + "index.js", ctx);
    const mod = ctx.ZPT;
    if (!mod || typeof mod.translateSelected !== "function") {
      throw new Error("主模块导出缺失（ctx.ZPT）");
    }
    Zotero.PaperTranslator = {
      translateSelected: mod.translateSelected,
      showPrefs: mod.showPrefs,
    };
    installMenus();
    Zotero.debug("paper-translator: 模块加载成功，开始安装菜单");
  } catch (e) {
    Zotero.logError("paper-translator 加载失败: " + e);
    // 可见告警：避免加载失败时静默无菜单，用户无从排查
    try {
      Zotero.alert(
        null,
        "论文翻译插件加载失败",
        "核心模块加载出错，菜单未安装：\n\n" + e.message +
          "\n\n请按 Ctrl+Shift+J 打开错误控制台，把包含 paper-translator 的日志发给我们排查。"
      );
    } catch (alertErr) {}
  }
}

function shutdown({ id }) {
  removeMenus();
  if (Zotero.PaperTranslator) delete Zotero.PaperTranslator;
  try { Components.utils.unload(rootURI + "index.js"); } catch (e) {}
}

function install() {}
function uninstall() {}

// ====== FTL 本地化：注入所有主窗口（含以后新开的窗口）======
// MenuManager 通过 data-l10n-id 渲染菜单项，FTL 必须在每个主窗口的 document 中。
// Zotero 启动时会把插件包 locale/<locale>/*.ftl 读入 L10nRegistry，此处只需挂 <link>。
function ensureFTLInWindow(win) {
  try {
    if (win && win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
      win.MozXULElement.insertFTLIfNeeded(FTL_FILE);
    }
  } catch (e) {
    Zotero.debug("paper-translator: FTL 注入失败（非致命） - " + e);
  }
}

function getMainWindows() {
  return Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
}

function installFTLForAllWindows() {
  for (const win of getMainWindows()) ensureFTLInWindow(win);
  // 以后新开的主窗口也要注入（插件启动后新窗口不会自动带 FTL）
  if (_windowListener) return;
  _windowListener = {
    onOpenWindow(xulWin) {
      try {
        const iface = Components.interfaces.nsIInterfaceRequestor;
        const domWin = xulWin.QueryInterface(iface).getInterface(
          Components.interfaces.nsIDOMWindowInternal || Components.interfaces.nsIDOMWindow
        );
        domWin.addEventListener("load", () => {
          if (domWin.ZoteroPane) ensureFTLInWindow(domWin);
        }, { once: true });
      } catch (e) {}
    },
    onCloseWindow() {},
    onWindowTitleChange() {},
  };
  try { Services.wm.addListener(_windowListener); } catch (e) {}
}

// ====== 菜单安装（兼容 Zotero 7/8/9）======
function installMenus() {
  const win = Zotero.getMainWindow();
  if (!win || !win.document) { setTimeout(installMenus, 500); return; }

  installFTLForAllWindows();

  // ---- 策略 A: Zotero 8+ MenuManager API ----
  // 官方签名（Zotero 8.0/9.0 源码 menuManager.js）：
  //   registerMenu({ menuID, pluginID, target, menus: [ {menuType, l10nID, onCommand, ...} ] })
  // menus 必填；注册失败时 registerMenu 静默返回 false，必须检查返回值。
  if (typeof Zotero.MenuManager !== "undefined" && Zotero.MenuManager.registerMenu) {
    const ok =
      registerMenuChecked({
        menuID: "zpt-menu-tools",
        pluginID: PLUGIN_ID,
        target: "main/menubar/tools",
        menus: [
          { menuType: "menuitem", l10nID: "zpt-menu-translate", onCommand: () => safeRun() },
          {
            menuType: "menuitem",
            l10nID: "zpt-menu-prefs",
            onCommand: () => {
              try {
                if (Zotero.PaperTranslator && Zotero.PaperTranslator.showPrefs) Zotero.PaperTranslator.showPrefs();
                else Zotero.alert(null, "论文翻译", "插件尚未加载完成，请稍后重试。");
              } catch (e) {
                Zotero.logError("paper-translator: 打开设置失败 - " + e);
              }
            },
          },
        ],
      }) &&
      registerMenuChecked({
        menuID: "zpt-item-menu",
        pluginID: PLUGIN_ID,
        target: "main/library/item",
        menus: [
          { menuType: "menuitem", l10nID: "zpt-item-translate", onCommand: () => safeRun() },
        ],
      });
    if (ok) {
      Zotero.debug("paper-translator: 使用 MenuManager API 注册菜单成功");
      return; // 成功则不需要 fallback
    }
    Zotero.debug("paper-translator: MenuManager 注册失败，回退到 DOM 操作");
  }

  // ---- 策略 B: Legacy DOM 操作（Zotero 7 或 MenuManager 失败时）----
  Zotero.debug("paper-translator: 使用 Legacy DOM 方式安装菜单");
  const doc = win.document;

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

  // 2) 工具菜单 — Zotero 7 的正确 ID 是 #menu_ToolsPopup（大写 T）；
  //    Zotero 9 中该 ID 不存在，此处仅作为 7 的兜底
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
        try {
          if (Zotero.PaperTranslator && Zotero.PaperTranslator.showPrefs) Zotero.PaperTranslator.showPrefs();
          else Zotero.alert(null, "论文翻译", "插件尚未加载完成，请稍后重试。");
        } catch (e) { Zotero.logError("paper-translator: 打开设置失败 - " + e); }
      });
      toolsPopup.appendChild(mi);
      Zotero.debug("paper-translator: 工具菜单(设置)已添加");
    }
  } else {
    Zotero.debug("paper-translator: 未找到 #menu_ToolsPopup，工具菜单无法添加");
  }
}

function registerMenuChecked(opts) {
  try {
    const ret = Zotero.MenuManager.registerMenu(opts);
    return ret !== false && !!ret;
  } catch (e) {
    Zotero.debug("paper-translator: MenuManager.registerMenu 异常 - " + e);
    return false;
  }
}

function removeMenus() {
  // MenuManager 注册的菜单会在插件 shutdown 时由 Zotero 自动注销并移除 DOM 元素，
  // 无需手动 unregister（其主键带插件命名空间，直接用 menuID 也注销不掉）。
  // 这里清理 Legacy DOM 添加的元素与注入的 FTL link。
  for (const win of getMainWindows()) {
    if (!win || !win.document) continue;
    const doc = win.document;
    ["zpt-menu-item", "zpt-menu-tools", "zpt-menu-prefs"].forEach((id) => {
      const el = doc.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    try {
      const l10nLink = doc.querySelector(`link[rel="localization"][href="${FTL_FILE}"]`);
      if (l10nLink && l10nLink.parentNode) l10nLink.parentNode.removeChild(l10nLink);
    } catch (e) {}
  }
  if (_windowListener) {
    try { Services.wm.removeListener(_windowListener); } catch (e) {}
    _windowListener = null;
  }
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
