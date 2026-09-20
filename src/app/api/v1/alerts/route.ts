import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { listAlerts } from "@/repositories/dashboard-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const items = listAlerts(getAppDatabase());
  return dataResponse(request, { items, total: items.length, demo: true });
}

export const GET = withApiAuth(handleGET);
