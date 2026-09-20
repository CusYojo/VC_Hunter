import { withApiAuth } from "@/security/api-auth";
import { handleChatConversations } from "@/ai/chat-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(handleChatConversations);
export const POST = withApiAuth(handleChatConversations);
