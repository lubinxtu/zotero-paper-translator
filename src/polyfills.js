// polyfills.js
// Zotero 插件沙箱（Cu.Sandbox）缺失的 Web API 补充。
// 在 bundle 加载时把这些实现挂到沙箱全局（globalThis），pdfjs 等模块以裸标识符读取即可命中。
// 注意：不要用 `var X = ...` 形式 —— loadSubScript 的目标对象语义下 var 不一定落到读取可见的作用域，
// 统一走 globalThis（realm 全局，free identifier 读取最终会落到这里）。

import {
  ReadableStream,
  WritableStream,
  TransformStream,
  ReadableStreamDefaultReader,
  ReadableByteStreamController,
  ReadableStreamDefaultController,
} from "web-streams-polyfill";
// Zotero 沙箱没有 structuredClone（pdfjs MessageHandler 的消息序列化路径用到）
import structuredClonePolyfill from "@ungap/structured-clone";

// pdfjs v6 的 getTextContent 走流式传输（MessageHandler.sendWithStream → new ReadableStream），
// 沙箱的 wantGlobalProperties 不含 ReadableStream/WritableStream/TransformStream。
if (typeof globalThis.ReadableStream === "undefined") {
  globalThis.ReadableStream = ReadableStream;
}
if (typeof globalThis.WritableStream === "undefined") {
  globalThis.WritableStream = WritableStream;
}
if (typeof globalThis.TransformStream === "undefined") {
  globalThis.TransformStream = TransformStream;
}
if (typeof globalThis.ReadableStreamDefaultReader === "undefined") {
  globalThis.ReadableStreamDefaultReader = ReadableStreamDefaultReader;
}
if (typeof globalThis.ReadableByteStreamController === "undefined") {
  globalThis.ReadableByteStreamController = ReadableByteStreamController;
}
if (typeof globalThis.ReadableStreamDefaultController === "undefined") {
  globalThis.ReadableStreamDefaultController = ReadableStreamDefaultController;
}
if (typeof globalThis.structuredClone !== "function") {
  // pdfjs 会以 structuredClone(obj, null) 调用（原生 API 接受 null options），
  // @ungap/structured-clone 对 null 会解构报错，这里包一层归一化
  globalThis.structuredClone = (value, options) =>
    structuredClonePolyfill(value, options == null ? undefined : options);
}
