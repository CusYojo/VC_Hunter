import { withApiAuth } from "@/security/api-auth";
import { handleChatConversation } from "@/ai/chat-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(handleChatConversation);
