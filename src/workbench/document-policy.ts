import { createHash } from "node:crypto";
import { extname } from "node:path";

export const MAX_PROJECT_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_EXTERNAL_DISABLED_MESSAGE = "资料外发暂未开放，仅支持本地分析。";
export type ProjectDocumentKind = "pdf" | "docx" | "text" | "markdown";

const RULES: Record<string, { kind: ProjectDocumentKind; mimes: readonly string[] }> = {
  ".pdf": { kind: "pdf", mimes: ["application/pdf"] },
  ".docx": { kind: "docx", mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  ".txt": { kind: "text", mimes: ["text/plain"] },
  ".md": { kind: "markdown", mimes: ["text/markdown", "text/plain"] },
  ".markdown": { kind: "markdown", mimes: ["text/markdown", "text/plain"] },
};

export function validateProjectDocument(input: { name: string; mimeType: string; bytes: Uint8Array }): { kind: ProjectDocumentKind; extension: string; sha256: string } {
  if (input.bytes.byteLength === 0) throw new Error("文件不能为空。");
  if (input.bytes.byteLength > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("单文件不能超过 20 MB。");
  const extension = extname(input.name).toLowerCase();
  const rule = RULES[extension];
  if (!rule) throw new Error("仅支持 PDF、DOCX、TXT 和 Markdown 文件。");
  if (!rule.mimes.includes(input.mimeType)) throw new Error("文件 MIME 类型与扩展名不匹配。");
  const bytes = Buffer.from(input.bytes);
  if (rule.kind === "pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF 文件头校验失败。");
  if (rule.kind === "docx" && bytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX 文件头校验失败。");
  if ((rule.kind === "text" || rule.kind === "markdown") && bytes.includes(0)) throw new Error("文本文件头包含二进制内容。");
  return { kind: rule.kind, extension, sha256: createHash("sha256").update(bytes).digest("hex") };
}
