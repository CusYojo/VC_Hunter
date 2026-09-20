import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { handleAddAttachment } from "@/workbench/deal-timeline-http";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { readProjectDocument } from "@/workbench/project-document-content";
import type { CurrentUser, TeamMember } from "@/workbench/contracts";

const projectId = "project-qiongxin";
const user: CurrentUser = { id: "user-demo", name: "示例经理", role: "投资经理", capabilities: [] };
const team: TeamMember[] = [{ id: "user-demo", name: "示例经理", role: "投资经理", tracks: ["半导体"], subtracks: [], currentLoad: 0 }];

describe("milestone file attachment", () => {
  let database: DatabaseSync;
  let repository: SqliteDealTimelineRepository;
  let storageRoot: string;
  let milestoneId: string;

  beforeEach(() => {
    database = createDatabase(":memory:"); initializeDatabase(database); seedDemoData(database);
    repository = new SqliteDealTimelineRepository(database, team);
    milestoneId = repository.createMilestone(projectId, { stage: "dd", title: "上传节点资料" }, "create-upload-node", user.id).id;
    storageRoot = mkdtempSync(join(tmpdir(), "milestone-file-"));
    vi.stubEnv("VC_HUNTER_DOCUMENT_ROOT", storageRoot);
  });
  afterEach(() => { database.close(); rmSync(storageRoot, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  function request(name: string, mimeType: string, bytes: string, key: string) {
    const form = new FormData();
    const version = Number((database.prepare("SELECT version FROM projects WHERE id=?").get(projectId) as { version: number }).version);
    form.set("expectedVersion", String(version));
    form.set("title", name);
    form.set("file", new File([bytes], name, { type: mimeType }));
    return handleAddAttachment(new Request(`http://localhost/api/v1/projects/${projectId}/milestones/${milestoneId}/attachments`, {
      method: "POST", headers: { "idempotency-key": key }, body: form,
    }), repository, user, projectId, milestoneId);
  }

  it("stores one validated project document and binds an idempotent milestone attachment", async () => {
    const first = await request("尽调纪要.txt", "text/plain", "节点原件正文", "milestone-file-key");
    expect(first.status).toBe(201);
    const payload = (await first.json()).data;
    expect(payload).toMatchObject({ milestoneId, title: "尽调纪要.txt", uri: null, projectVersion: expect.any(Number) });
    expect(payload.documentId).toBeTruthy();
    expect(readProjectDocument(database, projectId, payload.documentId, storageRoot).bytes.toString()).toBe("节点原件正文");

    const replay = await request("尽调纪要.txt", "text/plain", "节点原件正文", "milestone-file-key");
    expect((await replay.json()).data.id).toBe(payload.id);
    expect(database.prepare("SELECT count(*) AS count FROM project_documents WHERE project_id=?").get(projectId)).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM project_milestone_attachments WHERE milestone_id=?").get(milestoneId)).toEqual({ count: 1 });
  });

  it("rejects an unsupported executable without creating either record", async () => {
    const response = await request("恶意程序.exe", "application/octet-stream", "binary", "milestone-bad-file");
    expect(response.status).toBe(400);
    expect(database.prepare("SELECT count(*) AS count FROM project_documents WHERE project_id=?").get(projectId)).toEqual({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM project_milestone_attachments WHERE milestone_id=?").get(milestoneId)).toEqual({ count: 0 });
  });
});

