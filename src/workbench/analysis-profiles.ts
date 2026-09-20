import type { AnalysisProfile } from "./contracts";

const AVAILABLE_SKILLS = new Set([
  "analyze-technology@1.0.0", "analyze-market@1.0.0", "analyze-team@1.0.0",
  "analyze-competition@1.0.0", "analyze-risk@1.0.0",
]);

const PROFILES: readonly AnalysisProfile[] = Object.freeze([
  { id: "comprehensive-dd", version: "1.0.0", label: "综合尽调", description: "技术、市场、团队、竞争与风险的完整初筛。", agentRef: "project-research@1.1.0", skillRefs: [...AVAILABLE_SKILLS] },
  { id: "technology-moat", version: "1.0.0", label: "技术壁垒", description: "聚焦技术路线、工程化门槛、知识产权与可替代性。", agentRef: "project-research@1.1.0", skillRefs: ["analyze-technology@1.0.0", "analyze-competition@1.0.0"] },
  { id: "market-commercialization", version: "1.0.0", label: "市场与商业化", description: "聚焦客户、市场空间、商业模式与收入质量。", agentRef: "project-research@1.1.0", skillRefs: ["analyze-market@1.0.0"] },
  { id: "team-organization", version: "1.0.0", label: "团队与组织", description: "聚焦核心团队履历、组织能力与关键岗位缺口。", agentRef: "project-research@1.1.0", skillRefs: ["analyze-team@1.0.0"] },
  { id: "competitive-landscape", version: "1.0.0", label: "竞争格局", description: "聚焦竞品、差异化、上下游议价与潜在替代。", agentRef: "project-research@1.1.0", skillRefs: ["analyze-competition@1.0.0"] },
  { id: "risk-review", version: "1.0.0", label: "风险复核", description: "反向验证关键假设、合规风险与证据缺口。", agentRef: "project-research@1.1.0", skillRefs: ["analyze-risk@1.0.0"] },
]);

export const analysisProfileRegistry = {
  list: () => PROFILES.map((profile) => ({ ...profile, skillRefs: [...profile.skillRefs] })),
  resolve(profileId: string, requestedSkills: readonly string[] = []): AnalysisProfile {
    const profile = PROFILES.find((item) => item.id === profileId);
    if (!profile) throw new Error(`研究模板不存在：${profileId}`);
    for (const skill of requestedSkills) if (!AVAILABLE_SKILLS.has(skill)) throw new Error(`研究 Skill 不存在：${skill}`);
    const skillRefs = requestedSkills.length > 0 ? Array.from(new Set(requestedSkills)) : [...profile.skillRefs];
    return { ...profile, skillRefs };
  },
  hasSkill: (ref: string) => AVAILABLE_SKILLS.has(ref),
};
