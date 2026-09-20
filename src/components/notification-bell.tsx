"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Monitor, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { DesktopNotificationDelivery, desktopStatus, enableDesktopNotifications, notificationDestination, notificationLabels, setDesktopEnabled, type DesktopStatus, type InboxNotification } from "@/lib/desktop-notifications";

const desktopMessages: Record<DesktopStatus, string> = {
  on: "桌面通知已开启；保持平台页面打开即可接收。",
  off: "开启后，保持平台页面打开即可接收桌面提醒。",
  denied: "桌面通知被浏览器阻止，请在网站权限中允许通知。",
  unsupported: "当前浏览器或连接不支持桌面通知，请使用 HTTPS 桌面浏览器。",
  unavailable: "桌面通知暂不可用，请检查浏览器的通知和存储权限。",
};

export function NotificationBell() {
  const { push } = useRouter();
  const panelId = useId();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [desktop, setDesktop] = useState<DesktopStatus>("off");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const delivery = useRef(new DesktopNotificationDelivery());
  const request = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const version = useRef(0);

  const markRead = useCallback(async (item: InboxNotification, fromDesktop = false) => {
    if (mutating.current) return;
    if (fromDesktop) window.focus();
    if (!item.readAt) {
      mutating.current = true;
      setBusy(true);
      request.current?.abort();
      version.current += 1;
      try {
        const response = await fetch(`/api/v1/notifications/${encodeURIComponent(item.id)}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ read: true }),
        });
        if (!response.ok) throw new Error("read failed");
        const payload = await response.json();
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
        if (Number.isFinite(payload.data?.unread)) setUnread(payload.data.unread);
        setError("");
      } catch {
        setError("标记已读失败，请稍后重试。");
        if (fromDesktop) setOpen(true);
        return;
      } finally { mutating.current = false; setBusy(false); }
    }
    setOpen(false);
    push(notificationDestination(item));
  }, [push]);

  const load = useCallback(async () => {
    if (mutating.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const currentVersion = ++version.current;
    try {
      const response = await fetch("/api/v1/notifications?limit=200", { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { delivery.current.reset(); setItems([]); setUnread(0); setRecipientId(""); setSnapshotAt(null); }
        throw new Error("load failed");
      }
      const { data } = await response.json();
      if (controller.signal.aborted || currentVersion !== version.current) return;
      if (!data || !Array.isArray(data.items) || !Number.isFinite(data.unread)) throw new Error("invalid inbox");
      setItems(data.items);
      setUnread(data.unread);
      setSnapshotAt(data.snapshotAt ?? null);
      setError("");
      setLoaded(true);
      const owner = typeof data.recipientId === "string" ? data.recipientId : "";
      setRecipientId(owner);
      setDesktop(desktopStatus(owner));
      if (owner) void delivery.current.deliver(owner, data.items, (item) => void markRead(item, true)).catch(() => setDesktop("unavailable"));
    } catch {
      if (!controller.signal.aborted && currentVersion === version.current) setError("通知暂时无法更新，请重试。");
    }
  }, [markRead]);

  useEffect(() => {
    const desktopDelivery = delivery.current;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10_000);
    const refresh = () => void load();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(initial); clearInterval(timer); request.current?.abort(); desktopDelivery.reset();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener("storage", refresh); document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function markAllRead() {
    if (!snapshotAt || mutating.current) return;
    mutating.current = true; setBusy(true); request.current?.abort(); version.current += 1;
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ before: snapshotAt }),
      });
      if (!response.ok) throw new Error("read failed");
      setItems((current) => current.map((item) => item.createdAt <= snapshotAt && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item));
      setError("");
    } catch { setError("全部标记已读失败，请稍后重试。"); }
    finally { mutating.current = false; setBusy(false); }
    void load();
  }

  async function toggleDesktop() {
    if (!recipientId || permissionBusy) return;
    setPermissionBusy(true);
    const status = desktop === "on" ? setDesktopEnabled(recipientId, false) : await enableDesktopNotifications(recipientId);
    setDesktop(status); setPermissionBusy(false);
  }

  const visibleItems = unreadOnly ? items.filter((item) => !item.readAt) : items;
  return (
    <div className="notification-bell" ref={root}>
      <button ref={trigger} type="button" className="bell-button" aria-label={`提醒（${unread} 条未读）`} aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(!open); if (!open) void load(); }}>
        {unread > 0 ? <BellRing size={20} /> : <Bell size={20} />}
        {unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      <span className="sr-only" role="status" aria-atomic="true">{unread} 条未读提醒</span>
      {open && (
        <section id={panelId} className="bell-dropdown" aria-label="通知中心">
          <header><strong>通知中心</strong><span>{unread} 条未读</span></header>
          <div className="bell-tools">
            <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>{unreadOnly ? "查看全部" : "只看未读"}</button>
            <button type="button" disabled={busy || !unread || !snapshotAt} onClick={() => void markAllRead()}><CheckCheck size={15} />全部已读</button>
            <button type="button" aria-label="刷新通知" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /></button>
          </div>
          <div className="bell-desktop">
            <button type="button" disabled={!recipientId || permissionBusy || ["denied", "unsupported", "unavailable"].includes(desktop)} onClick={() => void toggleDesktop()}><Monitor size={15} />{permissionBusy ? "正在请求权限…" : desktop === "on" ? "关闭桌面通知" : "开启桌面通知"}</button>
            <p>{desktopMessages[desktop]}</p>
          </div>
          {error && <p className="bell-error" role="alert">{error}</p>}
          {!loaded && !error ? <p className="bell-hint">正在加载提醒…</p> : visibleItems.length === 0 ? <div className="empty-state small"><p>{unreadOnly ? "没有未读提醒" : "暂无提醒"}</p></div> : (
            <ul>{visibleItems.map((item) => (
              <li key={item.id} className={item.readAt ? "read" : "unread"}>
                <button type="button" disabled={busy} onClick={() => void markRead(item)}>
                  <span className="bell-kind">{notificationLabels[item.kind] ?? "工作提醒"}{!item.readAt && <span className="bell-unread-dot" aria-label="未读" />}</span>
                  <p>{item.message}</p>
                  <small>{item.projectName ? `${item.projectName} · ` : ""}{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
                </button>
              </li>
            ))}</ul>
          )}
          {items.length >= 200 && <p className="bell-hint">显示最近 200 条提醒</p>}
        </section>
      )}
    </div>
  );
}
