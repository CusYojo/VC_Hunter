import type { RoundLabel, Track } from "./types";

/**
 * 投资方历史表现分析（纯函数）。
 *
 * 关键设计约束（来自 PRD）：
 * - 跟投率按“公司”而非“轮次”计算，避免老基金因时间更久天然拥有更多轮次。
 * - 退出只统计该机构实际参与过其融资的标的，避免把未参与的并购算作自己业绩。
 * - 不同赛道分别聚合，避免 AI 和生物医药的退出节奏差异污染彼此。
 */

export interface InvestorParticipation {
  investorId: string;
  companyId: string;
  round: RoundLabel;
  announcedAt: string;
}

export interface InvestorPerformance {
  investorId: string;
  participatedCompanies: number;
  followOnRate: number | null;
  followOnCount: number;
  exitCount: number;
  trackExposure: Record<string, number>;
}

const ROUND_ORDER: Readonly<Record<RoundLabel, number>> = {
  angel: 0,
  pre_a: 1,
  a: 2,
  b: 3,
  c: 4,
  d_plus: 5,
  strategic: 6,
  other: 6,
};

export function computeFollowOnRate(participations: readonly InvestorParticipation[]): {
  followOnRate: number | null;
  followOnCount: number;
} {
  const roundsByCompany = new Map<string, Set<RoundLabel>>();
  for (const participation of participations) {
    const rounds = roundsByCompany.get(participation.companyId) ?? new Set<RoundLabel>();
    rounds.add(participation.round);
    roundsByCompany.set(participation.companyId, rounds);
  }
  const companies = roundsByCompany.size;
  if (companies === 0) return { followOnRate: null, followOnCount: 0 };

  let followOnCount = 0;
  for (const rounds of roundsByCompany.values()) {
    if (rounds.size >= 2) followOnCount += 1;
  }
  return { followOnRate: followOnCount / companies, followOnCount };
}

export function latestRound(participations: readonly InvestorParticipation[]): RoundLabel | null {
  if (participations.length === 0) return null;
  return [...participations].sort((a, b) => ROUND_ORDER[b.round] - ROUND_ORDER[a.round])[0].round;
}

export function computeTrackExposure(
  participations: readonly InvestorParticipation[],
  companyTrack: ReadonlyMap<string, Track>,
): Record<string, number> {
  const exposure: Record<string, number> = {};
  const seen = new Set<string>();
  for (const participation of participations) {
    const key = `${participation.companyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const track = companyTrack.get(participation.companyId) ?? "未分类";
    exposure[track] = (exposure[track] ?? 0) + 1;
  }
  return exposure;
}

export function computeInvestorPerformance(
  participations: readonly InvestorParticipation[],
  companyTrack: ReadonlyMap<string, Track>,
  exitedCompanyIds: ReadonlySet<string>,
): InvestorPerformance {
  const { followOnRate, followOnCount } = computeFollowOnRate(participations);
  const exitCount = participations.filter((participation) => exitedCompanyIds.has(participation.companyId)).length
    ? new Set(participations.filter((participation) => exitedCompanyIds.has(participation.companyId)).map((participation) => participation.companyId)).size
    : 0;
  const trackExposure = computeTrackExposure(participations, companyTrack);

  return {
    investorId: participations[0]?.investorId ?? "",
    participatedCompanies: new Set(participations.map((participation) => participation.companyId)).size,
    followOnRate,
    followOnCount,
    exitCount,
    trackExposure,
  };
}

/**
 * 退出判定只应依赖该机构真实参与过的标的。这里把“并购标的公司集合”作为输入，
 * 而不是在本模块内自行推断，以保持函数纯净、可测试。
 */
export function exitedCompanyIdsFor(
  targetCompanyIds: readonly string[],
  participationCompanyIds: readonly string[],
): ReadonlySet<string> {
  const participated = new Set(participationCompanyIds);
  return new Set(targetCompanyIds.filter((id) => participated.has(id)));
}
