import type { PersonEventType, SourceSignal } from "./types";

interface TalentAlertInput {
  eventType: PersonEventType;
  sources: SourceSignal[];
}

export interface TalentAlertDecision {
  severity: "high" | "medium" | "review";
  reason: string;
}

export function evaluateTalentAlert(input: TalentAlertInput): TalentAlertDecision {
  const independentGroups = new Set(input.sources.map((source) => source.independentGroup));
  const hasExplicitPrimaryStatement = input.sources.some(
    (source) => source.explicitStatement && (source.authority === "A" || source.authority === "B"),
  );
  const hasRegistrySource = input.sources.some((source) => source.authority === "A");

  if (
    input.eventType === "started_company" &&
    independentGroups.size >= 2 &&
    (hasExplicitPrimaryStatement || hasRegistrySource)
  ) {
    return { severity: "high", reason: "工商或明确声明已由独立来源交叉确认" };
  }

  if (
    hasExplicitPrimaryStatement &&
    (input.eventType === "left_company" || input.eventType === "started_company" || input.eventType === "joined_company")
  ) {
    return { severity: "medium", reason: "存在明确公开声明，等待补充独立证据" };
  }

  if (input.eventType === "paper_published" || input.eventType === "patent_filed") {
    return { severity: "review", reason: "技术成果属于辅助信号，需结合人才动向研判" };
  }

  return { severity: "review", reason: "仅有单一职业信号，待交叉验证" };
}
