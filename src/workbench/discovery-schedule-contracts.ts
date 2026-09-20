export interface DiscoveryScheduleView {
  enabled: boolean;
  version: number;
  timezone: "Asia/Shanghai";
  times: readonly ["10:00", "14:00"];
  nextRunAt: string | null;
  planCount: number;
  updatedAt: string;
}
