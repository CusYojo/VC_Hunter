"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AI_PROVIDERS, AI_PROVIDER_CATALOG_UPDATED_AT } from "@/ai/providers";
import type { AIProviderId, AISettingsView } from "@/ai/settings-contracts";

const inputClass = "mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm font-normal";
const buttonClass = "min-h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export function AISettings() {
  const [settings, setSettings] = useState<AISettingsView | null>(null);
  const [provider, setProvider] = useState<AIProviderId>("openai");
  const [model, setModel] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/settings/ai", { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "加载个人设置失败。");
      if (controller.signal.aborted) return;
      const current = result.data as AISettingsView;
      setSettings(current);
      const selected = current.activeProvider ?? "openai";
      setProvider(selected);
      setModel(current.providers.find((item) => item.provider === selected)?.model || AI_PROVIDERS.find((item) => item.id === selected)!.defaultModel);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败。"); });
    return () => controller.abort();
  }, [reload]);
  const catalog = AI_PROVIDERS.find((item) => item.id === provider)!;
  const configured = settings?.providers.find((item) => item.provider === provider)?.configured ?? false;
  function selectProvider(value: AIProviderId) {
    setProvider(value); setApiKey(""); setError(""); setSuccess("");
    setModel(settings?.providers.find((item) => item.provider === value)?.model || AI_PROVIDERS.find((item) => item.id === value)!.defaultModel);
  }
  async function act(action: "save" | "delete" | "test") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const body = action === "save" ? { provider, model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), activate: true } : action === "delete" ? { provider } : {};
      const response = await fetch(action === "test" ? "/api/v1/settings/ai/test" : "/api/v1/settings/ai", { method: action === "save" ? "PUT" : action === "delete" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "操作未完成，请重试。");
      if (action !== "test") { setSettings(result.data); setApiKey(""); }
      setSuccess(action === "save" ? "已保存为当前账号的默认模型。" : action === "delete" ? "已删除该服务商的个人密钥。" : "连接成功，模型已返回有效响应。");
    } catch (error) { setError(error instanceof Error ? error.message : "操作未完成，请重试。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <header><p className="text-xs font-semibold text-primary">个人设置</p><h1 className="mt-2 text-2xl font-semibold">AI 服务与模型</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">为自己的账号配置 API 和模型。AI 工作台与本人发起的研究任务使用这里的默认设置，费用由对应服务商账户承担。</p></header>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}{!settings && <button type="button" className="ml-3 underline" onClick={() => { setError(""); setReload((value) => value + 1); }}>重新加载</button>}</div>}
    {success && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">{success}</p>}
    {!settings ? !error && <p role="status" className="text-sm text-muted-foreground">正在加载个人设置…</p> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <form className="space-y-5 rounded-xl border bg-card p-5" onSubmit={(event) => { event.preventDefault(); void act("save"); }}>
        <div className="flex items-center gap-2"><KeyRound className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">API 连接</h2><span className="ml-auto text-xs text-muted-foreground">{configured ? "已配置密钥" : "尚未配置"}</span></div>
        <label className="block text-sm font-medium">服务商<select className={inputClass} value={provider} disabled={busy} onChange={(event) => selectProvider(event.target.value as AIProviderId)}>{AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="block text-sm font-medium">常用模型<select aria-label="常用模型" className={inputClass} value={catalog.models.includes(model) ? model : ""} disabled={busy} onChange={(event) => setModel(event.target.value)}><option value="">自定义模型 ID</option>{catalog.models.map((name) => <option key={name} value={name}>{name}{name === catalog.defaultModel ? "（新配置默认）" : ""}</option>)}</select></label>
        <label className="block text-sm font-medium">模型 ID<input required className={inputClass} value={model} disabled={busy} maxLength={128} onChange={(event) => setModel(event.target.value)} /></label>
        <p className="-mt-3 text-xs leading-5 text-muted-foreground">模型目录核对：{AI_PROVIDER_CATALOG_UPDATED_AT}。可下拉选择，也可以填入账号已获授权的模型 ID。<a href={catalog.docsUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary underline">查看官方文档</a></p>
        <label className="block text-sm font-medium">API Key<input type="password" autoComplete="new-password" spellCheck={false} className={inputClass} value={apiKey} disabled={busy} maxLength={2048} placeholder={configured ? "留空保留已保存的密钥" : "输入该服务商的 API Key"} onChange={(event) => setApiKey(event.target.value)} /></label>
        <p className="-mt-3 text-xs leading-5 text-muted-foreground">密钥加密保存在服务器，保存后不会回传到页面。切换服务商时需要使用该服务商自己的密钥。</p>
        <div className="flex flex-wrap gap-2"><button type="submit" className={`${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || !model.trim() || (!configured && !apiKey.trim())}>{busy ? "处理中…" : "保存并使用"}</button><button type="button" className={buttonClass} disabled={busy || !configured || settings.activeProvider !== provider || Boolean(apiKey) || model !== settings.providers.find((item) => item.provider === provider)?.model} onClick={() => void act("test")}>测试连接</button>{configured && <button type="button" className={`${buttonClass} text-destructive`} disabled={busy} onClick={() => void act("delete")}>删除密钥</button>}</div>
        <p className="text-xs text-muted-foreground">测试连接会向已保存的默认模型发送一条简短请求，可能产生少量 API 费用。</p>
      </form>
      <aside className="space-y-4 rounded-xl border bg-card p-5"><ShieldCheck className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">当前账号专用</h2><p className="text-sm leading-6 text-muted-foreground">其他成员无法查看或使用你的密钥。未配置时，系统会提示补充设置。</p><div className="border-t pt-4"><p className="text-xs text-muted-foreground">当前默认服务商</p><p className="mt-1 font-medium">{AI_PROVIDERS.find((item) => item.id === settings.activeProvider)?.label ?? "尚未设置"}</p><p className="mt-1 break-all text-xs text-muted-foreground">{settings.providers.find((item) => item.provider === settings.activeProvider)?.model}</p></div><Link href="/ai" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">前往 AI 工作台 →</Link></aside>
    </div>}
  </section>;
}
