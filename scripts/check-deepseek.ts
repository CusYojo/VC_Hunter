import { DeepSeekModelGateway } from "../src/connectors/deepseek-model-gateway";

const gateway = new DeepSeekModelGateway(process.env.DEEPSEEK_API_KEY ?? "", fetch, process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
const result = await gateway.generateResearchBrief({ projectName: "API 连接检查", track: "系统检查", evidence: [{ id: "health-evidence", quote: "这是连接检查输入，不代表任何外部事实。", authority: "D" }] });
process.stdout.write(`${JSON.stringify({ ok: true, model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash", result })}\n`);
