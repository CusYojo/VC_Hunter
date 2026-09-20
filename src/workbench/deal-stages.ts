/**
 * 项目推进的默认阶段目录。
 *
 * 阶段只是里程碑的分组键：每个项目可以在默认目录之外自定义阶段（任意字符串），
 * UI 会先按目录顺序展示已知阶段，再把自定义阶段追加在后面。
 */

export interface DealStageDefinition {
  id: string;
  label: string;
  /** 常见的小节点，作为"添加节点"时的快捷选项，不会自动创建。 */
  suggestedMilestones: readonly string[];
}

export const DEAL_STAGES: readonly DealStageDefinition[] = [
  { id: "contact", label: "接触", suggestedMilestones: ["首次沟通", "NDA 寄出", "NDA 签署", "拜访 / 现场交流", "索取 BP 与数据包"] },
  { id: "initiation", label: "立项", suggestedMilestones: ["立项材料撰写", "立项会", "立项结论"] },
  { id: "dd", label: "尽调", suggestedMilestones: ["业务尽调", "技术尽调", "客户 / 专家访谈", "财务尽调", "法务尽调", "现场尽调"] },
  { id: "pre_ic", label: "内决会", suggestedMilestones: ["内决会材料", "内决会", "TS 撰写定稿", "TS 寄出", "TS 回寄"] },
  { id: "ic", label: "投决会", suggestedMilestones: ["投决会材料", "投决会", "投决结论"] },
  { id: "closing", label: "签约交割", suggestedMilestones: ["SPA 谈判", "签约", "打款交割", "工商变更"] },
  { id: "post", label: "投后", suggestedMilestones: ["投后首次沟通", "季度跟踪", "下一轮融资跟进"] },
] as const;

export const MILESTONE_STATUS_LABELS = {
  planned: "计划中",
  in_progress: "进行中",
  done: "已完成",
  blocked: "受阻",
  cancelled: "已取消",
} as const;

const PROJECT_STATUS_BY_STAGE: Readonly<Record<string, string>> = {
  contact: "contacting",
  initiation: "researching",
  dd: "dd",
  pre_ic: "ic",
  ic: "ic",
  closing: "invested",
  post: "exited",
};

const DEAL_STAGE_BY_PROJECT_STATUS: Readonly<Record<string, string>> = {
  new: "contact",
  contacting: "contact",
  researching: "initiation",
  dd: "dd",
  ic: "ic",
  invested: "closing",
  exited: "post",
};

export function stageLabel(stageId: string): string {
  return DEAL_STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
}

/** 已知阶段按目录顺序，自定义阶段按首次出现顺序追加。 */
export function orderStages(stageIds: readonly string[]): string[] {
  const known = DEAL_STAGES.map((stage) => stage.id).filter((id) => stageIds.includes(id));
  const custom = stageIds.filter((id) => !DEAL_STAGES.some((stage) => stage.id === id));
  return [...known, ...Array.from(new Set(custom))];
}

/**
 * 当前进度取有效节点中流程位置最靠后的阶段。取消的节点不再代表项目进度；
 * 自定义阶段按首次出现顺序排在标准流程之后。
 */
export function deriveCurrentDealStage(
  milestones: readonly { stage: string; status?: string }[],
  fallbackStage: string,
): string {
  const activeStageIds = milestones.filter((milestone) => milestone.status !== "cancelled").map((milestone) => milestone.stage);
  return orderStages(activeStageIds).at(-1) ?? fallbackStage;
}

export function projectStatusForDealStage(stageId: string, fallbackStatus: string): string {
  return PROJECT_STATUS_BY_STAGE[stageId] ?? fallbackStatus;
}

export function dealStageForProjectStatus(status: string): string | undefined {
  return DEAL_STAGE_BY_PROJECT_STATUS[status];
}

export function dealStageIdForValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return DEAL_STAGES.find((stage) => stage.id === value || stage.label === value)?.id;
}

/** Automatic node writes are monotonic. A user may move backward through the manual stage action. */
export function autoAdvanceDealStage(currentStage: string | undefined, milestoneStage: string): string {
  if (!currentStage) return milestoneStage;
  const currentIndex = DEAL_STAGES.findIndex((stage) => stage.id === currentStage);
  const milestoneIndex = DEAL_STAGES.findIndex((stage) => stage.id === milestoneStage);
  if (currentIndex < 0) return currentStage;
  if (milestoneIndex < 0) return milestoneStage;
  return milestoneIndex > currentIndex ? milestoneStage : currentStage;
}
