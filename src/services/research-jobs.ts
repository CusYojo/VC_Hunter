import { randomUUID } from "node:crypto";
import type { ResearchJob, ResearchJobRepository } from "@/repositories/research-jobs";

interface CreateResearchJobInput {
  tenantId: string;
  projectId: string;
  idempotencyKey: string;
  workflow?: { id: string; version: string };
  profileId?: string;
  profileVersion?: string;
  skillRefs?: string[];
  requestedBy?: string;
  instructions?: string;
}

export function createResearchJob(
  repository: ResearchJobRepository,
  input: CreateResearchJobInput,
): ResearchJob {
  if (!input.idempotencyKey.trim()) {
    throw new Error("An idempotency key is required for research job writes.");
  }

  const existing = repository.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
  if (existing) {
    if (existing.projectId !== input.projectId || (input.requestedBy && existing.requestedBy !== input.requestedBy)) {
      throw new Error("Idempotency key was already used with a different payload.");
    }
    return existing;
  }
  const active = repository.findActiveByProjectId(input.tenantId, input.projectId);
  if (active) {
    if (input.requestedBy && active.requestedBy !== input.requestedBy) throw new Error("该项目已有其他成员发起的研究任务。");
    return active;
  }

  const job = {
    id: randomUUID(),
    tenantId: input.tenantId,
    projectId: input.projectId,
    idempotencyKey: input.idempotencyKey,
    status: "queued",
    createdAt: new Date().toISOString(),
    workflow: input.workflow ?? { id: "project-research", version: "1.0.0" },
    profileId: input.profileId ?? null,
    profileVersion: input.profileVersion ?? null,
    skillRefs: [...(input.skillRefs ?? [])],
    requestedBy: input.requestedBy ?? null,
    instructions: input.instructions ?? "",
  } as const;
  try {
    return repository.save(job);
  } catch {
    const raced = repository.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (raced?.projectId === input.projectId && (!input.requestedBy || raced.requestedBy === input.requestedBy)) return raced;
    if (raced) throw new Error("Idempotency key was already used with a different payload.");
    const activeRace = repository.findActiveByProjectId(input.tenantId, input.projectId);
    if (activeRace && (!input.requestedBy || activeRace.requestedBy === input.requestedBy)) return activeRace;
    throw new Error("Research job could not be persisted.");
  }
}
