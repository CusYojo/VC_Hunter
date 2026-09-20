import type { SourceSignal, ValueStatus } from "./types";

interface AssertionInput {
  subjectId: string;
  predicate: string;
  valueStatus: ValueStatus;
  value?: unknown;
  nullReason?: string;
  sourceIds: string[];
  method?: string;
}

export interface Assertion extends AssertionInput {
  epistemicType: "fact" | "estimate";
  estimated: boolean;
}

const NULL_STATUSES = new Set<ValueStatus>(["unknown", "not_disclosed", "not_applicable"]);

export function createAssertion(input: AssertionInput): Assertion {
  if (NULL_STATUSES.has(input.valueStatus) && !input.nullReason?.trim()) {
    throw new Error("A null reason is required for unavailable values.");
  }
  if (NULL_STATUSES.has(input.valueStatus) && input.value !== undefined) {
    throw new Error("Unavailable values cannot carry a value.");
  }
  if (input.valueStatus === "estimated" && (!input.method?.trim() || input.value === undefined)) {
    throw new Error("Estimated values require a method and value range.");
  }

  return {
    ...input,
    estimated: input.valueStatus === "estimated",
    epistemicType: input.valueStatus === "estimated" ? "estimate" : "fact",
  };
}

export function calculateEvidenceQuality(sources: SourceSignal[]): number {
  if (sources.length === 0) return 0;

  const authorityWeight = { A: 0.34, B: 0.26, C: 0.15, D: 0.07 } as const;
  const bestByIndependentGroup = new Map<string, number>();

  for (const source of sources) {
    const score = authorityWeight[source.authority] + (source.primary ? 0.12 : 0);
    const current = bestByIndependentGroup.get(source.independentGroup) ?? 0;
    bestByIndependentGroup.set(source.independentGroup, Math.max(current, score));
  }

  const independentScore = [...bestByIndependentGroup.values()].reduce((total, score) => total + score, 0);
  const corroborationBonus = bestByIndependentGroup.size > 1 ? 0.08 : 0;
  return Math.min(1, Number((independentScore + corroborationBonus).toFixed(2)));
}
