"use client";

import { DataTable, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag } from "@/components/ui/legacy";
import type { AgentSearchPlanView, DiscoveryCandidateView, ProjectCandidateView, SourceView, WebSearchLeadView } from "@/repositories/dashboard-data";

const SOURCE_HEADERS = [
  { key: "name", header: "信源" }, { key: "channel", header: "渠道" }, { key: "accessClass", header: "访问级别" }, { key: "allowExternalModel", header: "可用于外部模型" }, { key: "connectorStatus", header: "连接器" }, { key: "policyStatus", header: "合规状态" },
  { key: "lastRunStatus", header: "最近采集" }, { key: "lastRunAt", header: "采集时间" }, { key: "lastInsertedCount", header: "本次新增" },
  { key: "pendingCandidateCount", header: "待归并" }, { key: "documentCount", header: "文档" },
];
const CANDIDATE_HEADERS = [
  { key: "title", header: "发现标题" }, { key: "sourceName", header: "信源" }, { key: "matchedTrack", header: "赛道初筛" },
  { key: "publishedAt", header: "发布时间" }, { key: "status", header: "状态" },
];
const WEB_LEAD_HEADERS = [{ key: "title", header: "搜索线索" }, { key: "url", header: "URL" }, { key: "publishedAt", header: "发布时间" }, { key: "status", header: "证据状态" }];
const AGENT_HEADERS = [{ key: "name", header: "固定 Workflow" }, { key: "enabled", header: "状态" }, { key: "lastStatus", header: "上次结果" }, { key: "nextRunAt", header: "下次运行" }, { key: "consecutiveFailures", header: "连续失败" }];
const PROJECT_CANDIDATE_HEADERS = [{ key: "companyName", header: "候选项目" }, { key: "track", header: "赛道" }, { key: "investorNames", header: "相关机构" }, { key: "signalType", header: "信号" }, { key: "confidence", header: "模型置信度" }, { key: "leadUrl", header: "原始线索" }, { key: "status", header: "状态" }];

export function SourceOpsTables({ sources, candidates, webLeads, agentPlans, projectCandidates }: { sources: SourceView[]; candidates: DiscoveryCandidateView[]; webLeads: WebSearchLeadView[]; agentPlans: AgentSearchPlanView[]; projectCandidates: ProjectCandidateView[] }) {
  const sourceRows = sources.map((source) => ({ ...source, lastRunStatus: source.lastRunStatus ?? "never", lastRunAt: source.lastRunAt ?? "—" }));
  const candidateRows = candidates.map((candidate) => ({ ...candidate, matchedTrack: candidate.matchedTrack ?? "待分类", status: "待实体归并" }));
  const webLeadRows = webLeads.map((lead) => ({ ...lead, publishedAt: lead.publishedAt ?? "未提供", status: "仅线索，待回溯原始来源" }));
  const agentRows = agentPlans.map((plan) => ({ ...plan, enabled: plan.enabled ? "已启用" : "已停用", lastStatus: plan.lastStatus ?? "尚未运行" }));
  const projectCandidateRows = projectCandidates.map((candidate) => ({ ...candidate, investorNames: candidate.investorNames.join("、") || "未明确", confidence: `${Math.round(candidate.confidence * 100)}%`, status: "模型初筛，待人工复核" }));
  return <>
    <DataTable rows={agentRows} headers={AGENT_HEADERS}>{({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer title="后台 Agent Workflow" description="搜索模板、调度、租约与重试为固定流程；搜索结果由固定版本模型步骤做相关性和实体初筛。"><Table {...getTableProps()}><TableHead><TableRow>{headers.map((header) => { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key} {...props}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{rows.map((row) => { const { key, ...props } = getRowProps({ row }); return <TableRow key={key} {...props}>{row.cells.map((cell) => <TableCell key={cell.id}>{String(cell.value)}</TableCell>)}</TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    <DataTable rows={sourceRows} headers={SOURCE_HEADERS}>{({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer title="信源与采集运行" description="连接器状态、最近一次采集和待处理候选数量。"><Table {...getTableProps()}><TableHead><TableRow>{headers.map((header) => { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key} {...props}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{rows.map((row) => { const { key, ...props } = getRowProps({ row }); return <TableRow key={key} {...props}>{row.cells.map((cell) => <TableCell key={cell.id}>{renderSourceCell(cell.info.header, cell.value)}</TableCell>)}</TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    <DataTable rows={candidateRows} headers={CANDIDATE_HEADERS}>{({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer title="待实体归并候选" description="仅展示确定性赛道初筛；人工确认实体前不会创建项目、事件、评分或告警。"><Table {...getTableProps()}><TableHead><TableRow>{headers.map((header) => { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key} {...props}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{rows.map((row) => { const { key, ...props } = getRowProps({ row }); return <TableRow key={key} {...props}>{row.cells.map((cell) => <TableCell key={cell.id}>{cell.info.header === "status" ? <Tag type="purple">{String(cell.value)}</Tag> : String(cell.value)}</TableCell>)}</TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    <DataTable rows={projectCandidateRows} headers={PROJECT_CANDIDATE_HEADERS}>{({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer title="模型初筛项目候选" description="DeepSeek 使用固定 Prompt 和 JSON Schema 抽取；候选必须人工复核并回溯原始证据后才能进入正式项目库。"><Table {...getTableProps()}><TableHead><TableRow>{headers.map((header) => { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key} {...props}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{rows.map((row) => { const { key, ...props } = getRowProps({ row }); return <TableRow key={key} {...props}>{row.cells.map((cell) => <TableCell key={cell.id}>{cell.info.header === "status" ? <Tag type="cyan">{String(cell.value)}</Tag> : cell.info.header === "leadUrl" ? <a href={String(cell.value)} target="_blank" rel="noreferrer">查看线索</a> : String(cell.value)}</TableCell>)}</TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    <DataTable rows={webLeadRows} headers={WEB_LEAD_HEADERS}>{({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer title="外部网络搜索线索" description="搜索引擎结果仅用于发现 URL；必须回溯并采集原始来源后才能成为证据。"><Table {...getTableProps()}><TableHead><TableRow>{headers.map((header) => { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key} {...props}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{rows.map((row) => { const { key, ...props } = getRowProps({ row }); return <TableRow key={key} {...props}>{row.cells.map((cell) => <TableCell key={cell.id}>{cell.info.header === "status" ? <Tag type="magenta">{String(cell.value)}</Tag> : String(cell.value)}</TableCell>)}</TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
  </>;
}

function renderSourceCell(header: string, value: unknown) {
  if (header === "allowExternalModel") return <Tag type={value ? "green" : "gray"}>{value ? "允许" : "不允许"}</Tag>;
  if (header === "policyStatus") return <Tag type={value === "approved" ? "green" : value === "blocked" ? "red" : "warm-gray"}>{value === "approved" ? "已批准" : value === "blocked" ? "已阻止" : "仅手动"}</Tag>;
  if (header === "connectorStatus") return <Tag type={value === "enabled" ? "blue" : "gray"}>{value === "enabled" ? "已启用" : value === "disabled" ? "未启用" : "未配置"}</Tag>;
  if (header === "lastRunStatus") return <Tag type={value === "succeeded" || value === "not_modified" ? "green" : value === "failed" || value === "blocked" ? "red" : "gray"}>{formatRunStatus(String(value))}</Tag>;
  return String(value);
}

function formatRunStatus(status: string): string {
  return ({ succeeded: "成功", not_modified: "未变更", failed: "失败", blocked: "已阻止", running: "运行中", never: "尚未采集" } as Record<string, string>)[status] ?? status;
}
