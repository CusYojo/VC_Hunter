export interface DiscoveryConnectorRequest {
  queryFamily: string;
  tracks: readonly string[];
  subtracks: readonly string[];
  cities: readonly string[];
  dateFrom: string;
  dateTo: string;
  limit: number;
}

export interface DiscoveryConnectorResult {
  externalId: string;
  name: string;
  occurredAt: string;
  url: string;
  excerpt: string;
}

export interface DiscoveryConnector {
  readonly id: "qcc" | "tianyancha" | "boss";
  readonly enabled: boolean;
  readonly accessClass: "licensed_internal";
  collect(request: DiscoveryConnectorRequest): Promise<readonly DiscoveryConnectorResult[]>;
}

/** Contract placeholder only. A licensed API implementation must be injected explicitly. */
export function createLicensedConnector(id: DiscoveryConnector["id"], implementation: ((request: DiscoveryConnectorRequest) => Promise<readonly DiscoveryConnectorResult[]>) | null): DiscoveryConnector {
  return {
    id, enabled: Boolean(implementation), accessClass: "licensed_internal",
    async collect(request) {
      validateRequest(request);
      if (!implementation) throw new Error(`${connectorLabel(id)}尚未配置正式授权，连接器保持关闭。`);
      return implementation(request);
    },
  };
}

/** Used only for contract/integration tests with non-production fixtures. */
export class FixtureDiscoveryConnector implements DiscoveryConnector {
  readonly enabled = true;
  readonly accessClass = "licensed_internal" as const;
  constructor(readonly id: DiscoveryConnector["id"], private readonly results: readonly DiscoveryConnectorResult[]) {}
  async collect(request: DiscoveryConnectorRequest): Promise<readonly DiscoveryConnectorResult[]> { validateRequest(request); return this.results.slice(0, request.limit); }
}

function validateRequest(request: DiscoveryConnectorRequest): void {
  if (!request.queryFamily.trim() || request.limit < 1 || request.limit > 2_000 || !/^\d{4}-\d{2}-\d{2}$/u.test(request.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/u.test(request.dateTo)) throw new Error("连接器请求参数无效。");
}
function connectorLabel(id: DiscoveryConnector["id"]): string { return id === "qcc" ? "企查查" : id === "tianyancha" ? "天眼查" : "招聘平台"; }
