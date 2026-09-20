import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const responsibleInputFields = {
  assignee: z.string().trim().min(1).max(120).optional(),
  assignees: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
};
export function normalizeResponsibles(input: { assignee?: string; assignees?: string[] }, team: ReadonlyArray<{ id: string; name: string }>, required = true) {
  if (input.assignee && input.assignees) throw new Error("请只使用一种负责人选择方式。");
  const owners = [...new Set(input.assignees ?? (input.assignee ? [input.assignee] : []))];
  if (required && owners.length === 0) throw new Error("请至少选择一位负责人。");
  if (owners.length > 50 || owners.some(name => !name.trim() || name.length > 120)) throw new Error("负责人选择无效。");
  return owners.map(name => {
    const matches = team.filter(member => member.name === name);
    if (matches.length !== 1) throw new Error("负责人不是团队成员。");
    return { name, id: matches[0].id };
  });
}
/** Must be called inside the transaction that changes projects.owner and version. */
export function replaceProjectResponsibles(db: DatabaseSync, projectId: string, members: ReadonlyArray<{ name: string; id: string }>, now: string) {
  db.prepare("DELETE FROM project_responsibles WHERE project_id=?").run(projectId);
  const insert = db.prepare("INSERT INTO project_responsibles(project_id,member_name,member_id,position,assigned_at) VALUES (?,?,?,?,?)");
  members.forEach((member, position) => insert.run(projectId, member.name, member.id, position, now));
}
