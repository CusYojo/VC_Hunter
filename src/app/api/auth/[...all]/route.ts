import { getAuth } from "@/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return Response.json({ error: { code: "AUTH_UNAVAILABLE", message: "登录服务暂不可用，请联系管理员。" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
