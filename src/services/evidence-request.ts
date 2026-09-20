import type { EvidenceRequestInput, SqliteProjectRepository } from "@/repositories/projects";

export function requestEvidence(repository: SqliteProjectRepository, input: EvidenceRequestInput) {
  if (input.note.trim().length < 8) throw new Error("A substantive evidence request note is required.");
  return repository.requestEvidence({ ...input, note: input.note.trim() });
}
