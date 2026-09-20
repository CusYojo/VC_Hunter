import { getAppDatabase } from "@/db/app";
import { withApiAuth } from "@/security/api-auth";
import { handleDiscoverySchedule } from "@/services/discovery-schedule-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth((request) => handleDiscoverySchedule(request, getAppDatabase()));
export const PATCH = withApiAuth((request) => handleDiscoverySchedule(request, getAppDatabase()));
