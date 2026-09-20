import { randomUUID } from "node:crypto";

export interface ApiMeta {
  traceId: string;
  requestId: string;
  version: "v1";
}

export function createMeta(request: Request): ApiMeta {
  return {
    traceId: request.headers.get("x-trace-id") ?? randomUUID(),
    requestId: request.headers.get("x-request-id") ?? randomUUID(),
    version: "v1",
  };
}

export function dataResponse(request: Request, data: unknown, init?: ResponseInit): Response {
  return Response.json({ data, meta: createMeta(request) }, init);
}

export function errorResponse(
  request: Request,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return Response.json({ error: { code, message, details }, meta: createMeta(request) }, { status });
}
