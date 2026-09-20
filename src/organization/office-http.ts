import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { OfficeError } from "./office-contracts";
import { officeContext } from "./office-service";

export async function readOfficeBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 512 * 1024) { await reader.cancel(); throw new OfficeError(413, "PAYLOAD_TOO_LARGE", "请求内容超过限制。"); }
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export async function officeRequest(request: Request, operation: "workspace" | "style" | "profile" | "layout") {
  try {
    const { actor, directory, repository } = await officeContext(request);
    const data = operation === "workspace" ? repository.workspace(actor, directory) : operation === "style" ? repository.updateStyle(actor, directory, await readOfficeBody(request)) : operation === "profile" ? repository.updateProfile(actor, directory, await readOfficeBody(request)) : repository.updateLayout(actor, directory, await readOfficeBody(request));
    return dataResponse(request, data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof OfficeError) return errorResponse(request, error.status, error.code, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "SCHEMA_INVALID", "请检查工位颜色、形状和位置。");
    console.error("Office operation failed", { type: error instanceof Error ? error.name : "Unknown" });
    return errorResponse(request, 500, "INTERNAL_ERROR", "办公室暂时不可用，请稍后重试。");
  }
}
