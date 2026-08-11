# zotero-paper-translator

> 在 Zotero 7 / 8 / 9 中一键把选中的英文 PDF 论文翻译成中文，保留公式与表格结构，并生成可导入 Zotero 的中译附件。

本插件源自 `paper-translator` 工作流：把"PDF 论文翻译 → 结构化 Markdown → 公式渲染 → 可导入 Zotero 的文档"这套流程，封装成一个开箱即用的 Zotero 插件。与社区现有片段级翻译插件（如 zotero-pdf-translate）的差异在于：**全文结构化翻译 + 公式保留 + 可导出的独立翻译文档**。

## 功能

- **全文结构化翻译**：按章节、段落、表格、图注逐块翻译，保留原文的层级结构（I./II. 章节、子节、附录、参考文献条目等）。
- **公式零改写**：所有 `$...$`（行内）与 `$$...$$`（独立）公式原样保留为 LaTeX，由 MathJax 渲染，绝不破坏符号。
- **表格无损**：表格数值、单位、表头原样保留，输出为 Markdown 表格。
- **术语统一**：内置计算机视觉 / 机器人 / SLAM 领域术语基准（SLAM、BA、共视图、本质图、重投影误差、Sim(3) 等），并支持自定义术语表。
- **可导入 Zotero 的产出**：翻译结果作为该文献的**子附件**保存（HTML，公式经 MathJax 渲染）；可选"打印 → 另存为 PDF"。
- **可配置 LLM 后端**：OpenAI 兼容接口（OpenAI / DeepSeek / Claude / 本地兼容服务等），自带 API Key 与端点。

## 安装

1. 到 [Releases](https://github.com/lubinxtu/zotero-paper-translator/releases) 下载 `zotero-paper-translator.xpi`。
2. 在 Zotero 中：`工具 → 插件`（或 `设置 → 插件`）→ 齿轮图标 → `Install Add-on From File…` → 选择下载的 `.xpi`。
3. 重启 Zotero。

> 要求 Zotero 7.0 及以上（已在 **Zotero 9.0.6** 验证；manifest 兼容范围 `7.0` – `9.0.*`）。

## 使用

1. 在 Zotero 选中一篇文献，**或其 PDF 附件**（支持多选，批量翻译）。
2. 右键 → **「翻译为中文」**（或在 `工具` 菜单中点击 `论文翻译：翻译选中 PDF`）。
3. 首次使用需在 `Zotero 首选项 → 论文翻译` 填写 **API Key / 端点 / 模型**（也可通过 `工具 → 论文翻译：设置 API Key` 弹窗配置）。
4. 翻译完成后，会生成名为「《标题》（中译）」的 HTML 子附件，双击在浏览器中打开即可查看（公式已渲染）；点击页面右上角「打印 / 另存为 PDF」可导出 PDF。

## 配置（首选项）

| 项 | 说明 | 默认 |
|---|---|---|
| API Key | LLM 服务的密钥 | 空（必填） |
| 端点 Base URL | OpenAI 兼容的 Chat Completions 基址 | `https://api.openai.com/v1` |
| 模型名 | 如 `gpt-4o-mini`、`deepseek-chat` | `gpt-4o-mini` |
| 温度 | 翻译随机性 | `0.2` |
| 重试次数 | 限流/失败重试 | `3` |
| 输出模式 | `html`（中译附件）/ `pdf`（额外自动打开打印） | `html` |
| 自定义术语表 | 每行 `英文 → 中文`，覆盖/补充内置基准 | 空 |

> 若首选项面板未显示，也可通过 `工具 → 论文翻译：设置 API Key` 弹窗配置，或在 `about:config` 中搜索 `extensions.zotero-paper-translator.` 手动设置。

## 从源码构建

```bash
git clone https://github.com/lubinxtu/zotero-paper-translator.git
cd zotero-paper-translator
npm install          # 安装 esbuild / pdfjs-dist / archiver
npm run build        # 打包 ESM 到 addon/
npm run package      # 生成 zotero-paper-translator.xpi
```

`npm run package` 产物为仓库根目录下的 `zotero-paper-translator.xpi`，可直接拖入 Zotero 安装。

## 架构

```
选中 PDF
   │
   ▼
extract.js   ── pdfjs-dist 逐页抽取文本、按行重建、识别结构块（标题/段落/表格/图注）
   │
   ▼
translate.js ── 调用 OpenAI 兼容接口，套用术语表系统提示词，逐块翻译（含重试/限流退避）
   │
   ▼
render.js    ── 渲染为带 MathJax 的 HTML（CJK 衬线字体 + 表格 + 打印按钮）
   │
   ▼
index.js     ── 写入临时文件，作为 Zotero 子附件导入（Zotero.Attachments.importFromFile）
```

相对 `paper-translator` 技能的两处关键替换：

1. **翻译后端**：WorkBuddy agent → 可配置的 LLM API（用户自带 Key / 端点 / 模型）。
2. **PDF 渲染**：无头 Chrome `--print-to-pdf` → Zotero 内置 + 浏览器打印导出（插件无法调用外部 Chrome）。

## 已知限制

- 公式以 LaTeX 形式被 LLM 保留并交由 MathJax 渲染；若原文公式在 PDF 中未以文本层提供（纯图片公式），将无法识别，会以"见图 X"占位。
- 双栏 / 复杂表格的版式还原为启发式，极端排版可能错位。
- 翻译质量取决于所选 LLM；建议在首选项中选用支持长上下文的模型。
- 兼容性已在 **Zotero 9.0.6** 验证（设置面板与菜单注入正常）；更早版本（7 / 8）按 manifest 范围支持，欢迎反馈。菜单采用 `Zotero.MenuManager.registerMenu`（Zotero 8+ 标准 API，`menus` 数组 + `l10nID`，标签经 Fluent 本地化）并 fallback 到 `#menu_ToolsPopup`；设置面板通过 `Zotero.PreferencePanes.register` 注册。

## 更新日志

- **v0.1.12**：修复「设置 API Key」点击无反应 —— Zotero 沙箱没有 `window.prompt/confirm`，旧 `showPrefs()` 一调用就抛错被静默吞掉。现在「设置 API Key」直接打开已注册的偏好面板（`Zotero.Utilities.Internal.openPreferences("zpt-prefpane")`），未配置 API Key 时也引导到面板填写；错误不再静默（记入日志）。
- **v0.1.11**：修复插件核心模块在 Zotero 9 中加载失败的根因 —— 插件 bootstrap 运行在无 DOM 的 `Cu.Sandbox` 里，**动态 `import()` 不可用**（抛 `No ScriptLoader found for the current context`）。改为：主模块打成 IIFE 由 `Services.scriptloader.loadSubScript` 加载（Zotero 官方示例同款模式）；pdf.js worker 静态打包进同一 bundle，并通过 pdfjs 官方主线程钩子 `globalThis.pdfjsWorker` 直连（不再做任何运行时模块加载）；沙箱缺失的 `DOMMatrix` / `performance` / `AbortSignal` / `AbortController` / `ReadableStream` / `Uint8Array.toHex` / `Promise.withResolvers` 由构建时补齐；加载失败会弹窗提示。
- **v0.1.10**：修复 pdfjs v6 顶层 `new DOMMatrix()` 在沙箱中崩溃的问题（该版本被 v0.1.11 的更完整方案取代）。
- **v0.1.9**：修复 Zotero 8/9 菜单不显示 —— 按官方源码核对并修正 `MenuManager.registerMenu` 签名（`menus` 数组必填）、检查注册返回值并真正回退；FTL 改为标准多行 `.label` 属性；`build.mjs` 把 `locale/` 打入 xpi；FTL 注入所有主窗口并支持新开窗口。
- **v0.1.8**：重写菜单系统（MenuManager + `#menu_ToolsPopup` fallback），新增"设置 API Key"入口。
- **v0.1.7**：新增备用配置弹窗（`showPrefs`），改进偏好面板注册。
- **v0.1.3–v0.1.5**：Zotero 9 兼容（`strict_max_version` 用 `x.x.*` 格式）。

## 许可证

[MIT](LICENSE)
