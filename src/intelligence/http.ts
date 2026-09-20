import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { authenticationRequired, identityScope } from "@/security/identity-scope";
import { IntelligenceDiscoveryError, IntelligenceDiscoveryRepository } from "./repository";
import { discoveryPlanUpdateSchema } from "./contracts";

const filtersSchema = z.object({
  entityType: z.enum(["company", "person", "technology"]).optional(),
  channel: z.enum(["venture_tech", "registry", "hiring", "ranking_award", "manual_codex"]).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  track: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(["A", "B", "C"]).optional(),
  completeness: z.enum(["L0", "L1", "L2"]).optional(),
  status: z.enum(["pending_review", "promoted", "dismissed", "merged"]).optional(),
  query: z.string().trim().max(300).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

export async function handleDiscoveryItems(request: Request, database: DatabaseSync): Promise<Response> {
  const repository = new IntelligenceDiscoveryRepository(database);
  try {
    if (request.method === "GET") {
      const filters = filtersSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      const page = repository.list(filters);
      const roles = identityScope.getStore()?.roles ?? (authenticationRequired() ? [] : ["investment_manager"]);
      const canViewContacts = roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role));
      const items = page.items.map((item) => repository.get(item.id) ?? item).map((item) => canViewContacts ? item : { ...item, contacts: [] });
      return dataResponse(request, { ...page, items });
    }
    const identity = requireIdentity();
    const body = JSON.parse((await readAIBody(request, 2 * 1024 * 1024)).toString("utf8"));
    return dataResponse(request, repository.create(body, { actorId: identity.accountId, idempotencyKey: request.headers.get("idempotency-key") ?? "", now: new Date().toISOString() }), { status: 201 });
  } catch (error) { return discoveryErrorResponse(request, error, "候选保存失败。"); }
}

export async function handleDiscoveryItemUpdate(request: Request, database: DatabaseSync, id: string): Promise<Response> {
  try {
    const identity = requireIdentity();
    const body = JSON.parse((await readAIBody(request, 128 * 1024)).toString("utf8"));
    const result = new IntelligenceDiscoveryRepository(database).update(id, body, { actorId: identity.accountId, idempotencyKey: request.headers.get("idempotency-key") ?? "", now: new Date().toISOString() });
    return dataResponse(request, result);
  } catch (error) { return discoveryErrorResponse(request, error, "候选编辑失败。"); }
}

export async function handleDiscoveryItemReview(request: Request, database: DatabaseSync, id: string): Promise<Response> {
  try {
    const identity = requireIdentity();
    const body = JSON.parse((await readAIBody(request, 128 * 1024)).toString("utf8"));
    const result = new IntelligenceDiscoveryRepository(database).review(id, body, { actorId: identity.accountId, idempotencyKey: request.headers.get("idempotency-key") ?? "", now: new Date().toISOString() });
    return dataResponse(request, result);
  } catch (error) { return discoveryErrorResponse(request, error, "候选审核失败。"); }
}

export async function handleImportPreview(request: Request, database: DatabaseSync): Promise<Response> {
  try {
    const identity = requireIdentity();
    const bytes = await readAIBody(request, 16 * 1024 * 1024);
    const body = JSON.parse(bytes.toString("utf8"));
    const result = new IntelligenceDiscoveryRepository(database).previewImport(body, { tenantId: identity.tenantId, actorId: identity.accountId, idempotencyKey: request.headers.get("idempotency-key") ?? "", rawBytes: bytes.byteLength, now: new Date().toISOString() });
    return dataResponse(request, result);
  } catch (error) { return discoveryErrorResponse(request, error, "数据包预检失败。"); }
}

export async function handleImportCommit(request: Request, database: DatabaseSync, id: string): Promise<Response> {
  try {
    const identity = requireIdentity();
    const body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(JSON.parse((await readAIBody(request, 4_096)).toString("utf8")));
    const result = new IntelligenceDiscoveryRepository(database).commitImport(id, { tenantId: identity.tenantId, actorId: identity.accountId, expectedVersion: body.expectedVersion, now: new Date().toISOString() });
    return dataResponse(request, result, { status: 201 });
  } catch (error) { return discoveryErrorResponse(request, error, "数据包确认失败。"); }
}

export async function handleDiscoveryPlans(request: Request, database: DatabaseSync): Promise<Response> {
  const repository = new IntelligenceDiscoveryRepository(database);
  try {
    if (request.method === "GET") return dataResponse(request, { items: repository.listPlans() });
    const identity = requireIdentity();
    const body = discoveryPlanUpdateSchema.extend({ id: z.string().trim().min(1).max(200) }).strict().parse(JSON.parse((await readAIBody(request, 64 * 1024)).toString("utf8")));
    const { id, ...update } = body;
    return dataResponse(request, repository.updatePlan(id, update, { actorId: identity.accountId, idempotencyKey: request.headers.get("idempotency-key") ?? "", now: new Date().toISOString() }));
  } catch (error) { return discoveryErrorResponse(request, error, "发现计划保存失败。"); }
}

export function handleTechnologies(request: Request, database: DatabaseSync): Response {
  try {
    const query = z.object({ query: z.string().trim().max(300).optional(), track: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    return dataResponse(request, new IntelligenceDiscoveryRepository(database).listTechnologies(query));
  } catch (error) { return discoveryErrorResponse(request, error, "技术情报暂不可用。"); }
}

export function handleTechnologyDetail(request: Request, database: DatabaseSync, id: string): Response {
  try {
    const item = new IntelligenceDiscoveryRepository(database).getTechnology(id);
    return item ? dataResponse(request, item) : errorResponse(request, 404, "NOT_FOUND", "技术情报不存在。");
  } catch (error) { return discoveryErrorResponse(request, error, "技术情报暂不可用。"); }
}

function requireIdentity() {
  const identity = identityScope.getStore();
  if (!identity && !authenticationRequired()) return { accountId: "local-demo", tenantId: "local-demo" };
  if (!identity) throw new IntelligenceDiscoveryError("INVALID_INPUT", "请先登录。");
  return identity;
}

export function discoveryErrorResponse(request: Request, error: unknown, fallback: string): Response {
  if (error instanceof IntelligenceDiscoveryError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "VERSION_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    return errorResponse(request, status, error.code, error.message);
  }
  if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "请求内容超过允许大小。");
  if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_INPUT", "请检查请求字段、来源 URL 和日期格式。", error instanceof z.ZodError ? error.flatten() : undefined);
  console.error("Intelligence discovery request failed", { method: request.method, path: new URL(request.url).pathname, type: error instanceof Error ? error.name : "Unknown" });
  return errorResponse(request, 500, "DISCOVERY_FAILED", fallback);
}
