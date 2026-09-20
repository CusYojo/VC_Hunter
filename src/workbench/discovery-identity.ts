const financingSignals = new Set(["funding", "financing", "investment", "融资", "投融资", "投资融资", "融资投资"]);

export function normalizeDiscoveryIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s·•・—_()（）\[\]【】.,，。'"“”‘’]/gu, "");
}

export function normalizeDiscoverySignal(value: string): string {
  const normalized = normalizeDiscoveryIdentity(value);
  return financingSignals.has(normalized) ? "funding" : normalized;
}

export function discoveryEventIdentity(name: string, day: string, signalType: string): string {
  return [normalizeDiscoveryIdentity(name), day, normalizeDiscoverySignal(signalType)].join("|");
}
