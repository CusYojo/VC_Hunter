export const AI_SKILLS = [
  { id: "summary", name: "工作摘要", description: "概括要点、变化和待办", instruction: "根据输入整理工作摘要、关键变化、责任人与下一步。" },
  { id: "screening", name: "项目初筛", description: "技术、市场、团队与待核验问题", instruction: "根据材料给出项目初筛：技术、市场、团队、竞争、融资与风险，列出待核验问题，不替用户作投资决定。" },
  { id: "research", name: "行业研究", description: "产业链、竞争与研究提纲", instruction: "整理行业研究提纲、产业链、竞争格局、信息缺口；不能联网时明确指出，不编造近期信息。" },
  { id: "evidence", name: "证据核验", description: "核对来源、冲突和缺口", instruction: "逐项梳理材料中的断言、原文支持、冲突和缺失证据，不将未经核验内容当作事实。" },
  { id: "minutes", name: "会议纪要", description: "议题、决议与行动项", instruction: "整理会议纪要，区分讨论、决议与待办，保留原材料的责任人和日期，未提供则标注待确认。" },
  { id: "contract", name: "合同差异", description: "对比条款及待法律复核事项", instruction: "对比输入中的合同版本，指出条款差异、义务和待专业复核事项。仅有单版本时说明无法完成版本对比。" },
  { id: "risk", name: "投后风险", description: "梳理风险及跟进动作", instruction: "根据输入识别投后经营、财务、治理风险，列出证据、严重程度和建议核查动作，不编造经营数据。" },
] as const;
export type AIRun = { id: string; prompt: string; context: string; skill: string; provider: string; model: string; status: "running" | "succeeded" | "failed"; output: string; error: string | null; usage: { inputTokens?: number; outputTokens?: number }; createdAt: string; updatedAt: string };
export type AITemplate = { id: string; name: string; instructions: string; version: number; createdAt: string; updatedAt: string };
