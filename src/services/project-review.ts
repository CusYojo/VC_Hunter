import type { ReviewInput, SqliteProjectRepository } from "@/repositories/projects";

export function reviewProject(repository: SqliteProjectRepository, input: ReviewInput) {
  if (!input.note.trim()) throw new Error("A review note is required.");
  if (input.status === "pass" && input.note.trim().length < 8) {
    throw new Error("A reversible pass decision requires a clear reason.");
  }
  return repository.updateReview(input);
}
