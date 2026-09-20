"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, InlineNotification, Modal, Select, SelectItem, TextArea } from "@/components/ui/legacy";
import { Plus as Add, FilePlus2 as DocumentAdd, Lightbulb as Idea, UserPlus as UserFollow } from "lucide-react";
import type { AnalysisProfile, TeamMember } from "@/workbench/contracts";
import { recentFirstMembers, recordRecentActivityParticipants } from "@/components/activity-participant-picker";
import { DEAL_STAGES, dealStageForProjectStatus, projectStatusForDealStage, stageLabel } from "@/workbench/deal-stages";

interface ProjectActionsProps { projectId: string; version: number; owner: string | null | undefined; owners?: string[]; status?: string; dealStage?: string; team?: TeamMember[]; profiles?: AnalysisProfile[]; recentScopeKey?: string; }
type ActionMode = "assign" | "research" | "upload" | "judgment" | "stage";

export function ProjectActions({ projectId, version, owner, owners, status = "new", dealStage, team, profiles, recentScopeKey }: ProjectActionsProps) {
  const router = useRouter();
  const advanced = Boolean(team?.length && profiles?.length);
  const [currentVersion, setCurrentVersion] = useState(version);
  const [currentOwner, setCurrentOwner] = useState(owner);
  const [researchQueued, setResearchQueued] = useState(false);
  const [busy, setBusy] = useState<ActionMode | null>(null);
  const [modal, setModal] = useState<ActionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>(owners ?? (owner ? [owner] : []));
  const [personQuery, setPersonQuery] = useState("");
  const [profileId, setProfileId] = useState(profiles?.[0]?.id ?? "comprehensive-dd");
  const defaultSkills = useMemo(() => profiles?.find((item) => item.id === profileId)?.skillRefs ?? [], [profiles, profileId]);
  const [skillRefs, setSkillRefs] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [thesis, setThesis] = useState("");
  const [stance, setStance] = useState("neutral");
  const [currentStatus, setCurrentStatus] = useState(status);
  const [stage, setStage] = useState(status === "pass" ? "pass" : dealStage ?? dealStageForProjectStatus(status) ?? "contact");

  async function callJson(url: string, method: string, body: unknown) {
    const response = await fetch(url, { method, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "操作失败。");
    return payload.data;
  }
  async function assign() { setBusy("assign"); setError(null); try { const data = await callJson(`/api/v1/projects/${projectId}/assignment`, "PATCH", { expectedVersion: currentVersion, ...(advanced ? { assignees } : { assignee: "演示投资经理" }) }); setCurrentOwner(data.owner); setCurrentVersion(data.version); if (advanced) { const saved = data.owners ?? [data.owner]; setSuccess(`已分配给${saved.join("、")}`); setAssignees(saved); if (recentScopeKey) recordRecentActivityParticipants(recentScopeKey, (team ?? []).filter(member => saved.includes(member.name)).map(member => member.id)); router.refresh(); } setPersonQuery(""); setModal(null); } catch (cause) { setError(errorMessage(cause, "项目分配失败。")); } finally { setBusy(null); } }
  async function queueResearch() { setBusy("research"); setError(null); try { const body = advanced ? { projectId, profileId, skillRefs: skillRefs.length ? skillRefs : defaultSkills, instructions, expectedVersion: currentVersion } : { projectId }; const data = await callJson("/api/v1/research/jobs", "POST", body); setResearchQueued(data.status === "queued" || data.status === "running"); if (advanced) setSuccess("研究任务已入队"); setModal(null); } catch (cause) { setError(errorMessage(cause, "研究任务创建失败。")); } finally { setBusy(null); } }
  async function upload() { if (!file) return; setBusy("upload"); setError(null); try { const form = new FormData(); form.set("file", file); form.set("expectedVersion", String(currentVersion)); form.set("externalPolicy", "local_only"); const response = await fetch(`/api/v1/projects/${projectId}/documents`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: form }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "上传失败。"); setCurrentVersion(payload.data.projectVersion); setSuccess("资料已上传，可在项目知识库向助手提问"); setModal(null); setFile(null); router.refresh(); } catch (cause) { setError(errorMessage(cause, "资料上传失败。")); } finally { setBusy(null); } }
  async function recordJudgment() { setBusy("judgment"); setError(null); try { const data = await callJson(`/api/v1/projects/${projectId}/judgments`, "POST", { expectedVersion: currentVersion, thesis, stance, occurredAt: new Date().toISOString() }); setCurrentVersion(data.projectVersion); setSuccess("投资判断已写入时间线"); setModal(null); setThesis(""); } catch (cause) { setError(errorMessage(cause, "记录判断失败。")); } finally { setBusy(null); } }
  async function advanceStage() { setBusy("stage"); setError(null); try { const label = stage === "pass" ? "暂不跟进" : stageLabel(stage); const nextStatus = stage === "pass" ? "pass" : projectStatusForDealStage(stage, currentStatus); const data = await callJson(`/api/v1/projects/${projectId}/review`, "PATCH", { expectedVersion: currentVersion, status: nextStatus, ...(stage === "pass" ? {} : { dealStage: stage }), note: `手动选择项目阶段：${label}` }); setCurrentVersion(data.version); setCurrentStatus(data.status); setSuccess(`项目阶段已更新为${stage === "pass" ? label : data.dealStageLabel ?? label}`); setModal(null); router.refresh(); } catch (cause) { setError(errorMessage(cause, "阶段更新失败。")); } finally { setBusy(null); } }
  async function submit() { if (modal === "assign") await assign(); else if (modal === "research") await queueResearch(); else if (modal === "upload") await upload(); else if (modal === "judgment") await recordJudgment(); else if (modal === "stage") await advanceStage(); }

  if (!advanced) return <div className="project-actions legacy-actions"><Button kind="secondary" size="sm" disabled={Boolean(currentOwner) || busy !== null} onClick={assign}>{currentOwner ? `已分配给${currentOwner}` : busy === "assign" ? "分配中..." : "分配项目"}</Button><Button size="sm" renderIcon={Idea} disabled={researchQueued || busy !== null} onClick={queueResearch}>{researchQueued ? "研究任务已入队" : busy === "research" ? "入队中..." : "进入研究"}</Button>{error && <span className="action-error" role="alert">{error}</span>}{success && <span className="action-success" role="status">{success}</span>}</div>;

  const availableSkills = Array.from(new Set(profiles?.flatMap((item) => item.skillRefs) ?? []));
  const normalizedPersonQuery = personQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleTeam = recentFirstMembers(team ?? [], recentScopeKey).filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedPersonQuery));
  return <>
    <div className="project-action-wrap"><div className="project-actions"><Button kind="secondary" size="sm" renderIcon={UserFollow} onClick={() => setModal("assign")}>分配负责人</Button><Button size="sm" renderIcon={Idea} onClick={() => setModal("research")}>发起分析</Button><Button kind="tertiary" size="sm" renderIcon={DocumentAdd} onClick={() => setModal("upload")}>上传资料</Button><Button kind="ghost" size="sm" renderIcon={Add} onClick={() => setModal("judgment")}>记录判断</Button><Button kind="ghost" size="sm" onClick={() => setModal("stage")}>选择阶段</Button></div>{success && <span className="action-success" role="status">{success}</span>}{error && <span className="action-error" role="alert">{error}</span>}</div>
    <Modal open={modal !== null} modalHeading={modalTitle(modal)} primaryButtonText={busy ? "处理中..." : "确认"} secondaryButtonText="取消" primaryButtonDisabled={Boolean(busy) || (modal === "assign" && assignees.length === 0) || (modal === "upload" && !file) || (modal === "judgment" && thesis.trim().length < 2)} onRequestClose={() => { if (modal === "assign") { setAssignees(owners ?? (owner ? [owner] : [])); setPersonQuery(""); } setModal(null); setError(null); }} onRequestSubmit={submit}>
      {error && <InlineNotification kind="error" lowContrast title="操作未完成" subtitle={error} hideCloseButton />}
      {modal === "assign" && <fieldset className="max-h-72 overflow-y-auto"><legend className="mb-2 text-sm font-medium">项目负责人（可多选）</legend><label className="mb-2 block"><span className="sr-only">搜索项目负责人</span><input type="search" aria-label="搜索项目负责人" placeholder="搜索姓名或部门" value={personQuery} disabled={Boolean(busy)} onChange={event => setPersonQuery(event.target.value)} className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>{visibleTeam.map(member => {
        const unknown = member.assignmentProfileKnown === false;
        const tracks = member.tracks.join("/") || (unknown ? "赛道待补充" : "");
        const workload = unknown ? "负载待统计" : `在手 ${member.currentLoad}`;
        return <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted"><input type="checkbox" checked={assignees.includes(member.name)} onChange={event => setAssignees(current => event.target.checked ? [...current, member.name] : current.filter(name => name !== member.name))} />{`${member.name} · ${tracks} · ${workload}`}</label>;
      })}{visibleTeam.length === 0 && <p className="py-3 text-sm text-muted-foreground">没有匹配的人员</p>}{assignees.filter(name => !team?.some(member => member.name === name)).map(name => <label key={name} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm"><input type="checkbox" checked onChange={() => setAssignees(current => current.filter(item => item !== name))} />{name} · 已不在当前团队，可取消选择</label>)}</fieldset>}
      {modal === "research" && <div className="modal-form"><Select id="analysis-profile" labelText="研究模板" value={profileId} onChange={(event) => { setProfileId(event.target.value); setSkillRefs([]); }}>{profiles?.map((profile) => <SelectItem key={profile.id} value={profile.id} text={profile.label} />)}</Select><p className="form-note">{profiles?.find((profile) => profile.id === profileId)?.description}</p><fieldset><legend>高级 Skill（不选则使用模板默认项）</legend>{availableSkills.map((ref) => <Checkbox id={`skill-${ref}`} key={ref} labelText={ref.split("@")[0]} checked={skillRefs.includes(ref)} onChange={(_, data) => setSkillRefs((current) => data.checked ? [...current, ref] : current.filter((item) => item !== ref))} />)}</fieldset><TextArea id="research-instructions" labelText="补充说明（可选）" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={4000} /></div>}
      {modal === "upload" && <div className="modal-form"><label className="file-input-label" htmlFor="project-document">项目资料</label><input id="project-document" type="file" accept=".pdf,.docx,.txt,.md,.markdown" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>单文件 ≤ 20 MB；文件保存在服务器受限目录。</small><p className="form-note">上传时仅在服务器本地保存和解析；项目助手会在提问并确认后读取相关资料片段。</p></div>}
      {modal === "judgment" && <div className="modal-form"><Select id="judgment-stance" labelText="判断倾向" value={stance} onChange={(event) => setStance(event.target.value)}><SelectItem value="positive" text="积极" /><SelectItem value="neutral" text="中性" /><SelectItem value="cautious" text="谨慎" /><SelectItem value="negative" text="负面" /></Select><TextArea id="judgment-thesis" labelText="本期投资判断" value={thesis} onChange={(event) => setThesis(event.target.value)} rows={6} maxLength={8000} /></div>}
      {modal === "stage" && <div className="grid gap-2"><Select id="project-stage" labelText="当前项目阶段" value={stage} onChange={(event) => setStage(event.target.value)}>{DEAL_STAGES.map(item => <SelectItem key={item.id} value={item.id} text={item.label} />)}<SelectItem value="pass" text="暂不跟进" /></Select><p className="text-xs leading-5 text-muted-foreground">可手动前后调整；之后只有处于更后阶段的新节点或更新节点会自动推进项目。</p></div>}
    </Modal>
  </>;
}

export function ReviewDecisionButton({ projectId, version, requested }: { projectId: string; version: number; requested: boolean }) {
  const [complete, setComplete] = useState(requested); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit() { setBusy(true); setError(null); try { const response = await fetch(`/api/v1/projects/${projectId}/evidence-request`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: version, note: "保留冲突断言并请求补充独立来源证据。" }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "提交复核决定失败。"); setComplete(true); } catch (cause) { setError(errorMessage(cause, "提交复核决定失败。")); } finally { setBusy(false); } }
  return <><Button type="button" disabled={complete || busy} onClick={submit}>{complete ? "已请求补证" : busy ? "提交中..." : "保留冲突并请求补证"}</Button>{error && <span className="action-error" role="alert">{error}</span>}</>;
}

const modalTitle = (mode: ActionMode | null) => ({ assign: "分配项目负责人", research: "发起项目分析", upload: "上传项目资料", judgment: "记录本期投资判断", stage: "手动选择项目阶段" }[mode ?? "assign"]);
const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
