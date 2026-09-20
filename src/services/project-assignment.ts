import type { AssignmentInput, SqliteProjectRepository } from "@/repositories/projects";

export function assignProject(repository: SqliteProjectRepository, input: AssignmentInput) {
  return repository.assign({ ...input, ...(input.assignee ? { assignee: input.assignee.trim() } : {}), ...(input.assignees ? { assignees: input.assignees.map(value => value.trim()) } : {}) });
}
