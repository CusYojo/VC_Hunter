import { dataResponse, errorResponse } from "@/api/envelope";
import type { DatabaseSync } from "node:sqlite";
import { INSTITUTION_TYPE_VALUES, INVESTOR_STATUS_VALUES, TRACK_VALUES } from "@/domain/types";
import type { InstitutionType, InvestorPriority, InvestorStatus, Track } from "@/domain/types";
import { buildFundingDashboard } from "@/repositories/funding-dashboard";
import type { SqliteInvestorDirectoryRepository } from "@/repositories/investor-directory";
import type { CurrentUser } from "./contracts";
import { investorInputSchema, investorUpdateSchema } from "./contracts";
import { mappedError, parseJson, requireIdempotencyHeader } from "./http";

/** 机构名录与投融资看板的 HTTP 适配层；只做参数解析与错误映射，不含业务逻辑。 */

const PRIORITY_VALUES = new Set(["1", "2", "3"]);

export function handleListInvestors(request: Request, repository: SqliteInvestorDirectoryRepository): Response {
  const url = new URL(request.url);
  const read = (key: string) => url.searchParams.get(key)?.trim() ?? "";
  const status = read("status");
  const institutionType = read("type");
  const track = read("track");
  const priority = read("priority");
  if (status && status !== "all" && !INVESTOR_STATUS_VALUES.includes(status as InvestorStatus)) return errorResponse(request, 400, "SCHEMA_INVALID", "status 参数无效。");
  if (institutionType && institutionType !== "all" && !INSTITUTION_TYPE_VALUES.includes(institutionType as InstitutionType)) return errorResponse(request, 400, "SCHEMA_INVALID", "type 参数无效。");
  if (track && track !== "all" && !TRACK_VALUES.includes(track as Track)) return errorResponse(request, 400, "SCHEMA_INVALID", "track 参数无效。");
  if (priority && priority !== "all" && !PRIORITY_VALUES.has(priority)) return errorResponse(request, 400, "SCHEMA_INVALID", "priority 参数无效。");
  const page = Number.parseInt(read("page") || "1", 10);
  const perPage = Number.parseInt(read("perPage") || "50", 10);
  if (!Number.isFinite(page) || !Number.isFinite(perPage) || page < 1 || perPage < 1) return errorResponse(request, 400, "SCHEMA_INVALID", "分页参数无效。");
  const result = repository.list({
    status: (status || "all") as InvestorStatus | "all",
    institutionType: (institutionType || "all") as InstitutionType | "all",
    track: (track || "all") as Track | "all",
    priority: priority && priority !== "all" ? (Number(priority) as InvestorPriority) : "all",
    query: read("query"),
    page,
    perPage,
  });
  return dataResponse(request, result);
}

export function handleGetInvestor(request: Request, repository: SqliteInvestorDirectoryRepository, id: string): Response {
  const investor = repository.findById(id);
  return investor ? dataResponse(request, investor) : errorResponse(request, 404, "NOT_FOUND", "机构不存在。");
}

export async function handleCreateInvestor(request: Request, repository: SqliteInvestorDirectoryRepository, user: CurrentUser): Promise<Response> {
  if (!requireIdempotencyHeader(request)) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, investorInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "机构信息无效。", parsed.details);
  try {
    const created = repository.create(parsed.data, user.id);
    return dataResponse(request, created, { status: 201, headers: { location: `/api/v1/investors/${created.id}` } });
  } catch (error) { return mappedError(request, error, "INVESTOR_REJECTED", "创建机构失败。"); }
}

export async function handleUpdateInvestor(request: Request, repository: SqliteInvestorDirectoryRepository, user: CurrentUser, id: string): Promise<Response> {
  if (!requireIdempotencyHeader(request)) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, investorUpdateSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "机构信息无效。", parsed.details);
  const { expectedVersion, ...patch } = parsed.data;
  try { return dataResponse(request, repository.update(id, patch, expectedVersion, user.id)); }
  catch (error) { return mappedError(request, error, "INVESTOR_REJECTED", "更新机构失败。"); }
}

export function handleFundingDashboard(request: Request, database: DatabaseSync): Response {
  const raw = new URL(request.url).searchParams.get("window");
  const windowDays = raw ? Number.parseInt(raw, 10) : undefined;
  if (raw && (!Number.isFinite(windowDays) || (windowDays ?? 0) < 1)) return errorResponse(request, 400, "SCHEMA_INVALID", "window 参数须为正整数天数。");
  return dataResponse(request, buildFundingDashboard(database, { windowDays }));
}
