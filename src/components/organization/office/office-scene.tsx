"use client";

import { type CSSProperties, type DragEvent } from "react";
import type { OfficeGroup, OfficeMember, OfficeWorkspace } from "@/organization/office-contracts";
import { PixelDesk, PixelPlant } from "./pixel-art";
import { Minus, Plus, Scan } from "lucide-react";
import { MeetingRooms, OfficePeople, QueueSeats, selectOfficeQueues } from "./office-collaboration";
import { useOfficeZoom } from "./use-office-zoom";
import styles from "./office.module.css";

export const CELL_WIDTH = 108;
export const CELL_HEIGHT = 154;

export function OfficeScene({ groups, members, paused, editing, onMember, onMove, activity }: {
  groups: OfficeGroup[]; members: OfficeMember[]; activity?: OfficeWorkspace["activity"]; paused: boolean; editing: boolean;
  onMember: (id: string) => void; onMove: (groupId: string, memberId: string, x: number, y: number) => void;
}) {
  const roomWidths = groups.map(group => 40 + (Math.max(2, ...group.seats.map(seat => seat.x + 1)) + (editing ? 1 : 0)) * CELL_WIDTH);
  const rowWidths = roomWidths.reduce<number[]>((rows, width, index) => index % 2 ? [...rows.slice(0, -1), rows.at(-1)! + 12 + width] : [...rows, width], []);
  const minimumWidth = Math.max(280, ...rowWidths);
  const { viewport, scene, percent, scale, width, height, automatic, zoom: changeZoom, fit } = useOfficeZoom(minimumWidth);
  const queues = editing ? [] : selectOfficeQueues(activity, members.map(member => member.id));
  function drop(event: DragEvent<HTMLDivElement>, groupId: string) {
    event.preventDefault();
    try {
      const seat = JSON.parse(event.dataTransfer.getData("application/office-seat"));
      if (!editing || seat.groupId !== groupId || typeof seat.memberId !== "string") return;
      const rect = event.currentTarget.getBoundingClientRect();
      onMove(groupId, seat.memberId, Math.min(31, Math.max(0, Math.floor(((event.clientX - rect.left) / scale - 16) / CELL_WIDTH))), Math.min(127, Math.max(0, Math.floor(((event.clientY - rect.top) / scale - 16) / CELL_HEIGHT))));
    } catch { /* A drag from outside this office has no applicable seat. */ }
  }
  return <>
    <div className={styles.zoomControls} role="group" aria-label="地图缩放控制">
      <button type="button" aria-label="缩小办公室" disabled={percent <= 5} onClick={() => changeZoom(percent - 10)}><Minus size={16} /></button>
      <input type="range" min="5" max="150" step="1" aria-label="办公室缩放" value={percent} onChange={event => changeZoom(Number(event.target.value))} />
      <output aria-live="polite">{percent}%</output>
      <button type="button" aria-label="放大办公室" disabled={percent >= 150} onClick={() => changeZoom(percent + 10)}><Plus size={16} /></button>
      <button type="button" aria-pressed={automatic} onClick={fit}><Scan size={16} />适应屏幕</button>
    </div>
    <div className={styles.mapViewport} ref={viewport} tabIndex={0} aria-label="像素办公室，可滚动查看所有小组">
    <div className={styles.mapSize} style={{ width: width * scale, height: height }}>
    <div className={styles.scene} ref={scene} style={{ width: width, transform: `scale(${scale})` }}>

      <div className={styles.mapTitle}><span>VC HUNTER / TEAM OFFICE</span><span>项目协作地图</span></div>
      <div className={styles.rooms}>{groups.map((group, index) => {
        const columns = Math.max(2, ...group.seats.map(seat => seat.x + 1)) + (editing ? 1 : 0);
        const rows = Math.max(1, ...group.seats.map(seat => seat.y + 1)) + (editing ? 1 : 0);
        return <section key={group.id} className={styles.room} style={{ width: 32 + columns * CELL_WIDTH }} aria-label={`${group.label}小组`}>
          <div className={styles.roomHeader}><span className={styles.roomNumber}>{String(index + 1).padStart(2, "0")}</span><div><h2>{group.label}</h2><p>{group.kind === "project" ? "项目小组" : "部门工作区"} · {group.seats.length} 人</p></div><PixelPlant /></div>
          <div className={`${styles.floor} ${editing ? styles.editingFloor : ""}`} style={{ height: 38 + rows * CELL_HEIGHT }} onDragOver={event => { if (editing) event.preventDefault(); }} onDrop={event => drop(event, group.id)}>
            {group.seats.map(seat => {
              const member = members.find(item => item.id === seat.memberId);
              if (!member) return null;
              const project = member.projects.find(item => item.id === group.projectId) ?? member.projects.find(item => item.id === member.profile.displayedProjectId) ?? member.projects[0];
              return <button key={member.id} type="button" className={styles.seat} data-office-seat data-member={member.id} style={{ left: 16 + seat.x * CELL_WIDTH, top: 16 + seat.y * CELL_HEIGHT, "--desk-color": member.style.deskColor } as CSSProperties} draggable={editing} onDragStart={event => event.dataTransfer.setData("application/office-seat", JSON.stringify({ groupId: group.id, memberId: member.id }))} onClick={() => onMember(member.id)} aria-label={`查看${member.name}的工作 · ${group.label}`}>
                <span className={styles.desk}><PixelDesk color={member.style.deskColor} shape={member.style.deskShape} /></span>
                <strong className={styles.nameplate}>{member.name}{member.groupIds.length > 1 ? <sup>{member.groupIds.length}组</sup> : null}</strong>
                <span className={styles.seatStatus}>{member.profile.presenceStatus === "custom" ? member.profile.customStatus : member.profile.presenceStatus === "away" ? "外出" : member.profile.presenceStatus === "trip" ? "出差中" : "在公司"}</span>
                <span className={styles.seatProject} title={project?.name}>{project?.name ?? member.tasks[0]?.title ?? "暂无进行中工作"}</span>
                {(member.profile.description || project) && <span className={styles.seatUpdate} title={member.profile.description || project?.latestUpdate?.title || undefined}>{member.profile.description || (group.kind === "department" ? member.tasks[0]?.title ?? project?.latestUpdate?.title ?? "暂无推进记录" : project?.latestUpdate?.title ?? "暂无推进记录")}</span>}
              </button>;
            })}
            {!group.seats.length && <p className={styles.emptyRoom}>暂未安排工位</p>}
          </div>
          <QueueSeats queues={queues.filter(queue => groups.find(item => item.seats.some(seat => seat.memberId === queue.toMemberId))?.id === group.id)} members={members} onMember={onMember} />
          <footer className={styles.roomFooter}>{group.latestUpdate?.title ?? (group.kind === "project" ? "等待新的项目进展" : "按部门查看协作项目与事项")}</footer>
        </section>;
      })}{!editing && <MeetingRooms meetings={activity?.meetings ?? []} members={members} onMember={onMember} />}</div>
      <OfficePeople members={members} activity={activity} paused={paused} editing={editing} scene={scene} scale={scale} />
      <div className={styles.corridor}><PixelPlant /><span>一起把好项目往前推进</span><PixelPlant /></div>
    </div>
    </div>
  </div></>;
}
