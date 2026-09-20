export interface InboxNotification {
  id: string; kind: string; projectId: string | null; projectName?: string | null;
  targetUrl?: string | null; message: string; readAt: string | null; createdAt: string;
}

export type DesktopStatus = "on" | "off" | "denied" | "unsupported" | "unavailable";
export const notificationLabels: Record<string, string> = {
  mention: "提到我", milestone_assigned: "节点指派", task_assigned: "任务分配",
  project_assigned: "项目分配", approval_requested: "待我审批", approval_resolved: "审批结果",
  comment_added: "新批注", document_annotation: "资料批注", project_created: "项目入库",
  activity_invited: "日程邀请", approval_decided: "审批结果", activity_updated: "事项更新",
  activity_responded: "事项回应", activity_comment: "事项批注", project_comment: "项目批注",
  document_comment: "资料批注", document_reviewed: "资料审核",
};

function preferenceKey(recipientId: string) { return `vc-hunter:desktop:${recipientId}`; }

export function desktopStatus(recipientId: string): DesktopStatus {
  if (typeof window === "undefined" || !window.isSecureContext || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try { return Notification.permission === "granted" && localStorage.getItem(preferenceKey(recipientId)) === "on" ? "on" : "off"; }
  catch { return "unavailable"; }
}

export function setDesktopEnabled(recipientId: string, enabled: boolean): DesktopStatus {
  try { localStorage.setItem(preferenceKey(recipientId), enabled ? "on" : "off"); }
  catch { return "unavailable"; }
  return desktopStatus(recipientId);
}

// Called directly from a user's click so browsers can present their permission prompt.
export async function enableDesktopNotifications(recipientId: string): Promise<DesktopStatus> {
  const status = desktopStatus(recipientId);
  if (status === "unsupported" || status === "denied" || status === "unavailable") return status;
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    return permission === "granted" ? setDesktopEnabled(recipientId, true) : permission === "denied" ? "denied" : "off";
  } catch { return "unavailable"; }
}

export function notificationDestination(item: InboxNotification): string {
  if (item.targetUrl && /^\/(?!\/)/.test(item.targetUrl) && !/[\\\u0000-\u0020]/.test(item.targetUrl)) return item.targetUrl;
  return item.projectId ? `/projects/${encodeURIComponent(item.projectId)}` : "/work";
}

function readDelivered(key: string): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(-500) : [];
  } catch { return []; }
}

/** Account-scoped IDs only; no message contents are stored in the browser. */
export class DesktopNotificationDelivery {
  private recipientId: string | null = null;
  private seen = new Set<string>();
  private generation = 0;
  private active: Notification[] = [];

  reset(): void {
    this.generation += 1;
    this.recipientId = null;
    this.seen = new Set();
    for (const notification of this.active) notification.close();
    this.active = [];
  }

  async deliver(recipientId: string, items: readonly InboxNotification[], open: (item: InboxNotification) => void): Promise<void> {
    if (recipientId !== this.recipientId) {
      this.reset();
      this.recipientId = recipientId;
      this.seen = new Set(items.map((item) => item.id));
      return; // Establish a baseline without replaying historical notifications.
    }
    const fresh = items.filter((item) => !item.readAt && !this.seen.has(item.id));
    const acknowledge = (ids: string[]) => { this.seen = new Set([...this.seen, ...ids].slice(-500)); };
    acknowledge(items.filter((item) => item.readAt).map((item) => item.id));
    if (!fresh.length) return;
    if (desktopStatus(recipientId) !== "on") { acknowledge(fresh.map((item) => item.id)); return; }
    const generation = this.generation;
    const isCurrent = () => this.recipientId === recipientId && this.generation === generation;
    const show = () => {
      if (!isCurrent() || desktopStatus(recipientId) !== "on") return;
      const key = `${preferenceKey(recipientId)}:delivered`;
      const delivered = readDelivered(key);
      const pending = fresh.filter((item) => !delivered.includes(item.id));
      acknowledge(fresh.filter((item) => delivered.includes(item.id)).map((item) => item.id));
      for (const item of pending) {
        const notification = new Notification(`VC Hunter · ${notificationLabels[item.kind] ?? "新提醒"}`, {
          body: item.message, tag: `vc-hunter:${recipientId}:${item.id}`,
        });
        notification.onclick = () => { notification.close(); if (isCurrent()) open(item); };
        this.active = [...this.active.slice(-199), notification];
        acknowledge([item.id]);
        delivered.push(item.id);
        localStorage.setItem(key, JSON.stringify(delivered.slice(-500)));
      }
    };
    // Serialize delivery across tabs when supported; stable tags also coalesce duplicates.
    if (navigator.locks) await navigator.locks.request(preferenceKey(recipientId), show);
    else show();
  }
}
