"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConversation, ChatConversationView, ChatTurn } from "@/ai/chat-contracts";
import type { AISettingsView } from "@/ai/settings-contracts";

export type ChatDraft = { prompt: string; context: string; attachmentName: string; skill: string; templateId: string; consent: boolean; useKnowledge: boolean; projectId: string };
const emptyDraft = (): ChatDraft => ({ prompt: "", context: "", attachmentName: "", skill: "summary", templateId: "", consent: false, useKnowledge: false, projectId: "" });
const endpoint = "/api/v1/ai/conversations";
async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "加载失败，请重试。");
  return result.data as T;
}

export function useAIChat() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState<ChatDraft>(emptyDraft);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [original, setOriginal] = useState<{ name: string; url: string; isPdf: boolean; hasText: boolean } | null>(null);
  const originalUrl = useRef<string | null>(null);
  const pending = useRef(false);
  const sequence = useRef(0);
  const creationId = useRef<string | null>(null);
  const request = useRef<{ body: string; key: string; conversationId: string } | null>(null);
  useEffect(() => () => { if (originalUrl.current) URL.revokeObjectURL(originalUrl.current); }, []);
  function clearOriginal() {
    if (originalUrl.current) URL.revokeObjectURL(originalUrl.current);
    originalUrl.current = null; setOriginal(null);
  }
  const list = useCallback(async () => { setConversations(await read<ChatConversation[]>(endpoint)); }, []);
  const loadModel = useCallback(async () => {
    const settings = await read<AISettingsView>("/api/v1/settings/ai");
    setModel(settings.providers.find(item => item.provider === settings.activeProvider)?.model || "");
  }, []);
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => Promise.allSettled([list(), read<{ items: { id: string; name: string }[] }>("/api/v1/projects").then(value => { if (live) setProjects(value.items); }), loadModel()])).then(results => {
      if (!live) return;
      if (results.some(result => result.status === "rejected")) setError("部分工作区数据加载失败，请刷新页面重试。");
      setLoading(false);
    });
    return () => { live = false; sequence.current += 1; };
  }, [list, loadModel]);
  function update(patch: Partial<ChatDraft>) { setDraft(previous => ({ ...previous, ...patch, consent: patch.consent ?? false })); }
  function newChat() {
    if (pending.current) return;
    sequence.current += 1; creationId.current = null; request.current = null;
    setConversationId(null); setTurns([]); setDraft(emptyDraft()); setError(""); setNote(""); setLoading(false);
    clearOriginal();
  }
  async function open(id: string) {
    if (pending.current) return;
    const version = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await read<ChatConversationView>(`${endpoint}/${encodeURIComponent(id)}`);
      if (version !== sequence.current) return;
      setConversationId(id); setTurns(result.turns); creationId.current = id; request.current = null;
      clearOriginal();
      const last = result.turns.at(-1);
      setDraft({ ...emptyDraft(), useKnowledge: last?.useKnowledge ?? false, projectId: last?.projectId ?? "" }); setNote("");
    } catch (error) { if (version === sequence.current) setError(error instanceof Error ? error.message : "读取对话失败。"); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  async function refresh() {
    if (pending.current) return;
    const version = ++sequence.current; setLoading(true); setError("");
    try {
      const result = conversationId ? await read<ChatConversationView>(`${endpoint}/${encodeURIComponent(conversationId)}`) : null;
      if (version !== sequence.current) return;
      if (result) setTurns(result.turns);
      await list();
    } catch (error) { if (version === sequence.current) setError(error instanceof Error ? error.message : "刷新失败。"); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  async function send() {
    if (pending.current || loading || !draft.prompt.trim() || !draft.consent || (draft.useKnowledge && !draft.projectId)) return;
    pending.current = true; setBusy(true); setError(""); setNote("");
    try {
      let id = conversationId;
      if (!id) {
        creationId.current ??= crypto.randomUUID();
        const conversation = await read<ChatConversation>(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: creationId.current }) });
        id = conversation.id; setConversationId(id);
      }
      const body = JSON.stringify({ prompt: draft.prompt.trim(), context: draft.context, skill: draft.skill, consent: true, useKnowledge: draft.useKnowledge, ...(draft.useKnowledge ? { projectId: draft.projectId } : {}), ...(draft.attachmentName ? { attachmentName: draft.attachmentName } : {}), ...(draft.templateId ? { templateId: draft.templateId } : {}) });
      if (request.current?.body !== body || request.current.conversationId !== id) request.current = { body, key: crypto.randomUUID(), conversationId: id };
      const response = await fetch(`${endpoint}/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.current.key }, body });
      const result = await response.json(); const turn = result.data as ChatTurn | undefined;
      if (!turn?.id) throw new Error(result.error?.message || "发送未确认，请重试或刷新对话。");
      setTurns(previous => [...previous.filter(item => item.id !== turn.id), turn]);
      request.current = null;
      if (turn.status === "failed") { setError(turn.error || "调用失败，请重试。"); setDraft(previous => ({ ...previous, consent: false })); }
      else if (turn.status === "running") setNote("问题正在处理，可稍后点击刷新对话查看结果。");
      else setDraft(previous => ({ ...previous, prompt: "", context: "", attachmentName: "", consent: false }));
      await list().catch(() => setNote("回答已保存，最近对话列表暂未刷新。"));
    } catch (error) { setError(error instanceof Error ? error.message : "发送失败，请重试。"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function extract(file?: File) {
    if (!file || pending.current || loading) return;
    if (file.size > 20 * 1024 * 1024) { setError("单份资料不能超过 20 MB。"); return; }
    pending.current = true; setBusy(true); setError(""); setNote("正在读取资料…");
    try {
      clearOriginal();
      update({ context: "", attachmentName: file.name });
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const url = URL.createObjectURL(new Blob([file], { type: isPdf ? "application/pdf" : "application/octet-stream" }));
      originalUrl.current = url; setOriginal({ name: file.name, url, isPdf, hasText: false });
      const form = new FormData(); form.set("file", file);
      const result = await read<{ text: string; name: string; truncated: boolean; warning?: string }>("/api/v1/ai/extract", { method: "POST", body: form });
      update({ context: result.text, attachmentName: result.name });
      setOriginal(previous => previous ? { ...previous, hasText: Boolean(result.text.trim()) } : null);
      setNote(result.warning || (result.truncated ? "已提取前 50,000 字符，请核对正文后发送。" : "正文已提取，请核对后发送。"));
    } catch (error) { setError(error instanceof Error ? error.message : "资料读取失败，请粘贴正文后继续。"); setNote(""); }
    finally { pending.current = false; setBusy(false); }
  }
  return { conversations, conversationId, turns, draft, projects, model, loading, busy, error, note, original, clearOriginal, update, newChat, open, refresh, send, extract, loadModel };
}
