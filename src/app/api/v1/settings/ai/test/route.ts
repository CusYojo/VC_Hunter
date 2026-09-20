import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { getAppDatabase } from "@/db/app";
import { dataResponse, errorResponse } from "@/api/envelope";
import { createPersonalModelGateway } from "@/ai/personal-model";
import { aiWorkspaceError, readAIBody } from "@/ai/workspace-http";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request) => {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    z.object({}).strict().parse(JSON.parse((await readAIBody(request, 1024)).toString("utf8")));
    const model = createPersonalModelGateway(getAppDatabase(), owner);
    await model.generateText({ system: "This is an API connectivity check.", user: "Reply with OK only.", maxTokens: 4096 });
    return dataResponse(request, { connected: true, provider: model.provider, model: model.model });
  } catch (error) { return aiWorkspaceError(request, error); }
});
