import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ProjectFileOption } from "./activity-contracts";
const querySchema = z.object({ q: z.string().trim().max(200).default(""), projectId: z.string().trim().min(1).max(128).optional() }).strict();
export function listProjectFiles(db: DatabaseSync, raw: unknown): { items: ProjectFileOption[]; total: number; hasMore: boolean } {
  const input = querySchema.parse(raw);
  const where = "(?='' OR instr(lower(d.original_name),lower(?))>0 OR instr(lower(p.name),lower(?))>0) AND (? IS NULL OR d.project_id=?)";
  const params = [input.q, input.q, input.q, input.projectId ?? null, input.projectId ?? null];
  const rows = db.prepare(`SELECT d.id,d.project_id AS projectId,p.name AS projectName,d.original_name AS originalName,d.document_kind AS kind,d.byte_length AS byteLength,d.created_at AS createdAt FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE ${where} ORDER BY d.created_at DESC,d.id DESC LIMIT 101`).all(...params) as unknown as ProjectFileOption[];
  const count = db.prepare(`SELECT count(*) AS total FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE ${where}`).get(...params);
  return { items: rows.slice(0,100), total: Number(count?.total ?? 0), hasMore: rows.length > 100 };
}
