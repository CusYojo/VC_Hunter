import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MAX_PROJECT_DOCUMENT_BYTES, type ProjectDocumentKind } from "./document-policy";

const mediaTypes: Record<ProjectDocumentKind, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain; charset=utf-8", markdown: "text/markdown; charset=utf-8" };

export function readProjectDocument(database: DatabaseSync, projectId: string, documentId: string, storageRoot?: string) {
  const row = database.prepare("SELECT storage_key,original_name,document_kind FROM project_documents WHERE project_id=? AND id=?").get(projectId, documentId) as { storage_key: string; original_name: string; document_kind: ProjectDocumentKind } | undefined;
  if (!row) throw new Error("关联资料不存在。");
  if (!Object.hasOwn(mediaTypes, row.document_kind)) throw new Error("资料文件不可用。");
  const root = resolve(storageRoot ?? process.env.VC_HUNTER_DOCUMENT_ROOT ?? resolve(process.cwd(), ".data/project-documents"));
  const bytes = readSecureFile(root, row.storage_key);
  return { bytes, originalName: row.original_name, kind: row.document_kind, mediaType: mediaTypes[row.document_kind] };
}
function readSecureFile(root: string, key: string): Buffer {
  let descriptor: number | undefined;
  try {
    if (!key || basename(key) !== key || key.includes("\\") || key === "." || key === "..") throw new Error("资料文件不可用。");
    const rootStats = lstatSync(root);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("资料文件不可用。");
    descriptor = openSync(resolve(realpathSync(root), key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("资料文件不可用。");
    if (stats.size > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("单文件不能超过 20 MB。");
    // Read at most one byte over the limit, even if another process grows the file.
    const buffer = Buffer.alloc(Math.min(stats.size + 1, MAX_PROJECT_DOCUMENT_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("单文件不能超过 20 MB。");
    if (length !== stats.size) throw new Error("资料文件不可用。");
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof Error && error.message === "单文件不能超过 20 MB。") throw error;
    throw new Error("资料文件不可用。");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
