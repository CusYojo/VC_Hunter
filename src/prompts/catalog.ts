import { PromptRegistry } from "./registry";

export const PROMPT_REFS = Object.freeze({
  webSearch: { id: "investment-web-search", version: "1.0.0" },
  leadQualification: { id: "lead-qualification", version: "1.0.0" },
  researchBrief: { id: "research-brief", version: "1.0.0" },
} as const);

const WEB_SEARCH_SYSTEM = "你是投资项目网页发现助手。必须使用联网搜索，只返回搜索中实际找到的公开网页。不要推测 URL。优先企业官网、投资机构官网、政府与主流媒体。每个 highlights 必须是网页支持的简短事实摘要。只输出 JSON，禁止解释、Markdown 和代码围栏。固定格式：{\"results\":[{\"title\":\"\",\"url\":\"https://...\",\"publishedAt\":null,\"highlights\":[\"\"]}]}。";

const LEAD_QUALIFICATION_SYSTEM = "你是中国硬科技项目发现分类器。逐条判断搜索线索是否明确涉及投资机构投资中国硬科技公司。只能抽取输入原文中出现的公司名和机构名；不得推测。每条 lead 必须输出一条 assessment。track 只能使用枚举 AI|具身智能|半导体|核聚变|生物医药|商业航天|新材料；signalType 只能使用英文枚举 funding|investment|ma|milestone|talent|other。固定 JSON 格式：{\"assessments\":[{\"leadId\":\"\",\"relevant\":true,\"companyName\":null,\"track\":null,\"investorNames\":[],\"signalType\":\"other\",\"summary\":\"\",\"confidence\":0}]}. Prompt version: lead-qualification-v1";

const RESEARCH_BRIEF_SYSTEM = "你是中国硬科技投资研究助手。只能使用用户提供的证据。输出 JSON，不得补写未知事实。格式示例：{\"summary\":\"\",\"findings\":[{\"claim\":\"\",\"evidenceIds\":[\"evidence-id\"]}],\"risks\":[],\"openQuestions\":[]}";

export function createBuiltinPromptRegistry(): PromptRegistry {
  return new PromptRegistry([
    {
      ...PROMPT_REFS.webSearch,
      system: WEB_SEARCH_SYSTEM,
      maxTokens: 4_000,
      source: `${WEB_SEARCH_SYSTEM}\n最多返回 {{limit}} 条：{{query}}`,
      renderUser: (input: unknown) => {
        const value = input as { query: string; limit: number };
        return `搜索以下主题，最多返回 ${value.limit} 条不重复的网页线索，并严格按指定 JSON 格式输出：${value.query}`;
      },
    },
    {
      ...PROMPT_REFS.leadQualification,
      system: LEAD_QUALIFICATION_SYSTEM,
      maxTokens: 4_000,
      source: `${LEAD_QUALIFICATION_SYSTEM}\n{{inputJson}}`,
      renderUser: (input: unknown) => JSON.stringify(input),
    },
    {
      ...PROMPT_REFS.researchBrief,
      system: RESEARCH_BRIEF_SYSTEM,
      maxTokens: 2_000,
      source: `${RESEARCH_BRIEF_SYSTEM}\n{{inputJson}}`,
      renderUser: (input: unknown) => JSON.stringify(input),
    },
  ]);
}
