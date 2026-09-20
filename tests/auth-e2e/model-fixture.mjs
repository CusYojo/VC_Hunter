// Isolated full-app E2E provider fixture. This module is never imported by production code.
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const directory = process.env.VC_HUNTER_AUTH_E2E_DIRECTORY;
if (!directory || !isAbsolute(directory) || !basename(directory).startsWith("vc-hunter-auth-e2e-")
  || realpathSync(directory) !== resolve(directory)
  || readFileSync(join(directory, "auth-e2e-marker"), "utf8") !== "isolated-auth-e2e\n"
  || process.env.VC_HUNTER_CURRENT_TENANT_ID !== "isolated-auth-e2e"
  || process.env.VC_HUNTER_DB_PATH !== join(directory, "business.db")
  || process.env.VC_HUNTER_AUTH_DB_PATH !== join(directory, "auth.db")
  || process.env.BETTER_AUTH_URL !== "http://127.0.0.1:3107") {
  throw new Error("Model fixture requires the isolated authentication E2E environment.");
}
const endpoints = new Map([
  ["https://api.openai.com/v1/chat/completions", "openai"],
  ["https://api.anthropic.com/v1/messages", "claude"],
  ["https://api.moonshot.cn/v1/chat/completions", "kimi"],
  ["https://api.deepseek.com/chat/completions", "deepseek"],
  ["https://open.bigmodel.cn/api/paas/v4/chat/completions", "glm"],
  ["https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "qwen"],
]);
const originalFetch = globalThis.fetch;
globalThis.fetch = async function isolatedModelFetch(input, init) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const key = headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!key.startsWith("isolated-ai-test-")) return originalFetch(input, init);
  const url = input instanceof Request ? input.url : String(input);
  const provider = endpoints.get(url);
  if (!provider) throw new Error("Isolated test credentials cannot leave an approved fixture endpoint.");
  const body = JSON.parse(typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "{}");
  if (provider === "claude" && (headers.get("anthropic-version") !== "2023-06-01" || !Array.isArray(body.messages) || typeof body.system !== "string")) throw new Error("Invalid native Claude request.");
  if (provider !== "claude" && (!headers.get("authorization") || !Array.isArray(body.messages))) throw new Error("Invalid chat-completions request.");
  if (provider === "openai" && /^gpt-5\.6(?:-|$)/.test(body.model) && (!(body.max_completion_tokens > 0) || "max_tokens" in body || "temperature" in body)) throw new Error("Invalid GPT 5.6 request parameters.");
  appendFileSync(join(directory, "model-fixture-calls.jsonl"), JSON.stringify({ provider, model: body.model, nativeClaude: provider === "claude" }) + "\n", { mode: 0o600 });
  const user = body.messages.find((message) => message.role === "user")?.content ?? "";
  const isProjectQuestion = key === "isolated-ai-test-openai-project" && user.includes("项目知识问答验证");
  if (isProjectQuestion && (!user.includes("本项目专属验证资料：工程样机已于六月完成验证，下一步进行可靠性测试。")
    || user.includes("其他项目专属秘密：不可跨项目发送"))) throw new Error("Project fixture did not receive correctly scoped source text.");
  let chatText;
  if (key === "isolated-ai-test-openai-chat") {
    const sourceA = "对话项目甲独有证据";
    const sourceB = "对话项目乙独有证据";
    // Match the current question even when earlier questions appear in persisted context.
    if (user.includes("对话验证项目乙：")) {
      if (!user.includes(sourceB) || user.includes(sourceA) || user.includes("周工负责样机验证")) throw new Error("Chat project B scope leaked or omitted source context.");
      chatText = "陈工负责试生产，十一月二日交付。[S1]";
    } else if (user.includes("对话验证关闭知识：")) {
      if (user.includes(sourceA) || user.includes(sourceB) || user.includes("周工负责样机验证")) throw new Error("Disabled chat knowledge leaked source or previous grounded answer.");
      chatText = "当前普通对话上下文没有会议负责人信息，请重新提供。";
    } else if (user.includes("对话验证项目甲：")) {
      if (!user.includes(sourceA) || user.includes(sourceB)) throw new Error("Chat project A scope leaked or omitted source context.");
      chatText = "周工负责样机验证，十月十五日交付。[S1]";
    } else if (user.includes("对话验证第二轮：")) {
      if (!user.includes("记住会议负责人是林工") || !user.includes("已记住会议负责人是林工")) throw new Error("Chat follow-up omitted persisted conversation history.");
      chatText = "刚才指定的会议负责人是林工。";
    } else chatText = "已记住会议负责人是林工。";
  }
  const text = chatText ?? (isProjectQuestion ? "工程样机已于六月完成验证，下一步进行可靠性测试。[S1]"
    : user === "Reply with OK only." ? "OK" : "隔离测试模型结果：会议已确定资料复核负责人，下一步核验项目来源。");
  return Response.json(provider === "claude"
    ? { id: "fixture-claude", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 12, output_tokens: 20 } }
    : { id: "fixture-chat", model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } });
};
