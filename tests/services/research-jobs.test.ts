import { describe, expect, it } from "vitest";
import { InMemoryResearchJobRepository, type ResearchJobRepository } from "@/repositories/research-jobs";
import { createResearchJob } from "@/services/research-jobs";

describe("research job creation", () => {
  it("is idempotent for the same tenant and idempotency key", () => {
    const repository = new InMemoryResearchJobRepository();
    const input = { tenantId: "demo", projectId: "project-1", idempotencyKey: "job-key-1" };

    const first = createResearchJob(repository, input);
    const second = createResearchJob(repository, input);

    expect(second.id).toBe(first.id);
    expect(first.workflow).toEqual({ id: "project-research", version: "1.0.0" });
    expect(repository.list()).toHaveLength(1);
  });

  it("rejects writes without an idempotency key", () => {
    const repository = new InMemoryResearchJobRepository();
    expect(() => createResearchJob(repository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "" })).toThrow(/idempotency/i);
  });

  it("rejects reusing an idempotency key for a different project", () => {
    const repository = new InMemoryResearchJobRepository();
    createResearchJob(repository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "job-key-1" });

    expect(() => createResearchJob(repository, {
      tenantId: "demo",
      projectId: "project-2",
      idempotencyKey: "job-key-1",
    })).toThrow(/different payload/i);
  });

  it("reuses the active job when the same project is queued with another key", () => {
    const repository = new InMemoryResearchJobRepository();
    const first = createResearchJob(repository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "job-key-1" });
    const second = createResearchJob(repository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "job-key-2" });

    expect(second.id).toBe(first.id);
    expect(repository.list()).toHaveLength(1);
  });

  it("recovers a concurrent active-job race and sanitizes an unknown persistence failure", () => {
    const racedJob = { id: "race-job", tenantId: "demo", projectId: "project-1", idempotencyKey: "other-key", status: "queued" as const, createdAt: "2026-08-31T00:00:00.000Z" };
    let activeLookups = 0;
    const racedRepository: ResearchJobRepository = {
      findByIdempotencyKey: () => undefined,
      findActiveByProjectId: () => { activeLookups += 1; return activeLookups === 1 ? undefined : racedJob; },
      save: () => { throw new Error("database detail"); },
    };
    expect(createResearchJob(racedRepository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "new-key" })).toBe(racedJob);

    const failedRepository: ResearchJobRepository = { findByIdempotencyKey: () => undefined, findActiveByProjectId: () => undefined, save: () => { throw new Error("database detail"); } };
    expect(() => createResearchJob(failedRepository, { tenantId: "demo", projectId: "project-1", idempotencyKey: "new-key" })).toThrow("Research job could not be persisted.");
  });
});
