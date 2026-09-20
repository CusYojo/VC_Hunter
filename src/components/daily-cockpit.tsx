"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  DataTable,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from "@/components/ui/legacy";
import type { ProjectSummary, Track } from "@/domain/types";
import { filterProjects, TRACKS } from "@/domain/projects";

interface DailyCockpitProps {
  projects: ProjectSummary[];
}

const headers = [
  { key: "project", header: "项目" },
  { key: "whyNow", header: "为什么现在" },
  { key: "scores", header: "优先级" },
  { key: "evidence", header: "证据状态" },
  { key: "status", header: "跟进状态" },
];

export function DailyCockpit({ projects }: DailyCockpitProps) {
  const [track, setTrack] = useState<Track | "all">("all");
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const filtered = useMemo(() => filterProjects(projects, { track }), [projects, track]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const rows = filtered.map((project) => ({
    id: project.id,
    project: project.name,
    whyNow: project.whyNow ?? "待补充",
    scores: `${project.urgencyScore ?? "待评估"} / ${project.qualityScore ?? "待评估"}`,
    evidence: `${project.evidenceAuthority ?? "待定"} 级证据 · ${Math.round((project.evidenceQuality ?? 0) * 100)}%`,
    status: project.status,
  }));

  return (
    <section aria-labelledby="daily-signals-title">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">今日信号</p>
          <h2 id="daily-signals-title">需要投资团队处理的项目</h2>
        </div>
        <Select
          id="track-filter"
          labelText="筛选赛道"
          value={track}
          onChange={(event) => setTrack(event.target.value as Track | "all")}
        >
          <SelectItem value="all" text="全部赛道" />
          {TRACKS.map((item) => <SelectItem key={item} value={item} text={item} />)}
        </Select>
      </div>

      {!mounted ? <div className="table-loading" role="status">正在准备项目列表...</div> : <DataTable key={track} rows={rows} headers={headers}>
        {({ rows: tableRows, headers: tableHeaders, getHeaderProps, getRowProps, getTableProps }) => (
          <TableContainer title="高优先级信号" description="演示数据。默认按紧迫度和事件时间排序。">
            <Table {...getTableProps()} aria-label="今日项目发现信号">
              <TableHead>
                <TableRow>
                  {tableHeaders.map((header) => {
                    const { key, ...props } = getHeaderProps({ header });
                    return <TableHeader key={key} {...props}>{header.header}</TableHeader>;
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((row) => {
                  const project = projectsById.get(row.id);
                  if (!project) return null;
                  const { key, ...rowProps } = getRowProps({ row });
                  return (
                    <TableRow key={key} {...rowProps} data-testid="signal-row">
                      <TableCell>
                        <Link prefetch={false} className="project-link" href={`/projects/${project.id}`}>{project.name}</Link>
                        <span className="cell-secondary">{project.track} / {project.subtrack}</span>
                      </TableCell>
                      <TableCell><span className="why-now">{project.whyNow}</span></TableCell>
                      <TableCell>
                        <span className="score-pair"><strong>{project.urgencyScore ?? "—"}</strong><small>{project.urgencyScore === undefined ? "待评估" : "紧迫度"}</small></span>
                        <span className="score-pair"><strong>{project.qualityScore ?? "—"}</strong><small>{project.qualityScore === undefined ? "待评估" : "项目质量"}</small></span>
                      </TableCell>
                      <TableCell>
                        <Tag type={project.evidenceAuthority === "A" ? "blue" : "teal"} size="sm">{project.evidenceAuthority ?? "待定"} 级证据</Tag>
                        <span className="cell-secondary">可追溯 · {Math.round((project.evidenceQuality ?? 0) * 100)}%</span>
                      </TableCell>
                      <TableCell><Tag type="gray" size="sm">{statusLabel(project.status)}</Tag></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>}
    </section>
  );
}

function statusLabel(status: ProjectSummary["status"]): string {
  return { new: "新发现", researching: "研究中", contacting: "接触中", dd: "尽调中", ic: "IC", pass: "暂不跟进", invested: "已投资", exited: "已退出" }[status];
}
