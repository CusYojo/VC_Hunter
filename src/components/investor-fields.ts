export const INSTITUTION_LABELS: Record<string, string> = { financial_vc: "财务 VC", cvc: "产业资本", local_government: "地方国资 / 基金", national_fund: "国家级基金", pe: "PE", incubator: "孵化器", other: "其他" };
export const INVESTOR_STATUS_LABELS: Record<string, string> = { seed_candidate: "待核验", verified: "已核验", active: "活跃档案", paused: "暂停跟进", merged: "已合并" };
export const INVESTOR_PRIORITY_LABELS: Record<number, string> = { 1: "S · 头部必看", 2: "A · 重点关注", 3: "观察" };

export function publicSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
