"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { OfficeMember, OfficeMeeting, OfficeQueue, OfficeWorkspace } from "@/organization/office-contracts";
import { PixelPerson } from "./pixel-art";
import styles from "./collaboration.module.css";

type Point = { x: number; y: number };
type Placement = { member: OfficeMember; points: Point[]; mode: "desk" | "roaming" | "queue" | "meeting"; label: string; queueId?: string; recipient?: Point; home: Point };

export function MeetingRooms({ meetings, members, onMember }: { meetings: OfficeMeeting[]; members: OfficeMember[]; onMember: (id: string) => void }) {
  return <>{meetings.map(meeting => {
    const people = members.filter(member => meeting.memberIds.includes(member.id));
    if (!people.length) return null;
    return <section key={meeting.id} className={styles.meetingRoom} role="region" aria-label={`会议室 · ${meeting.title}`}>
      <header><span>会议进行中</span><h2>{meeting.title}</h2><p>{people.length} 人 · 按会议事项状态展示</p></header>
      <div className={styles.meetingSeats}>{people.map(member => <button type="button" key={member.id} data-office-meeting-seat={meeting.id} data-member={member.id} onClick={() => onMember(member.id)} aria-label={`查看${member.name}的会议工作`}><span className={styles.chair} /><strong>{member.name}</strong></button>)}</div>
      <footer>会议完成后自动返回工位</footer>
    </section>;
  })}</>;
}

export function selectOfficeQueues(activity: OfficeWorkspace["activity"], memberIds: string[]): OfficeQueue[] {
  const attending = new Set(activity?.meetings.flatMap(meeting => meeting.memberIds) ?? []);
  const visible = new Set(memberIds);
  return [...(activity?.queues ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).filter(queue => {
    return queue.kind === "approval" && !attending.has(queue.fromMemberId) && !attending.has(queue.toMemberId) && visible.has(queue.fromMemberId) && visible.has(queue.toMemberId);
  });
}

export function QueueSeats({ queues, members, onMember }: { queues: OfficeQueue[]; members: OfficeMember[]; onMember: (id: string) => void }) {
  if (!queues.length) return null;
  return <div className={styles.waitingArea} aria-label="工位等候区"><p>项目资料审批排队</p><div>{queues.map(queue => <button type="button" key={queue.id} data-office-queue-seat={queue.id} onClick={() => onMember(queue.fromMemberId)} aria-label={`查看${members.find(member => member.id === queue.fromMemberId)?.name}的排队工作`}><span className={styles.waitingSpot} /><strong>{members.find(member => member.id === queue.fromMemberId)?.name}</strong><small>等候 {members.find(member => member.id === queue.toMemberId)?.name}</small></button>)}</div></div>;
}

function placementsFor(root: HTMLDivElement, members: OfficeMember[], activity: OfficeWorkspace["activity"], scale: number, editing: boolean): Placement[] {
  const bounds = root.getBoundingClientRect();
  const seats = [...root.querySelectorAll<HTMLElement>("[data-office-seat]")];
  const meetingSeats = [...root.querySelectorAll<HTMLElement>("[data-office-meeting-seat]")];
  const point = (element: HTMLElement, x = 42, y = 16): Point => { const rect = element.getBoundingClientRect(); return { x: (rect.left - bounds.left) / scale + x, y: (rect.top - bounds.top) / scale + y }; };
  const meetings = editing ? [] : activity?.meetings ?? [];
  const activeQueues = editing ? [] : selectOfficeQueues(activity, seats.map(seat => seat.dataset.member!));
  const queueSeats = [...root.querySelectorAll<HTMLElement>("[data-office-queue-seat]")];
  return members.flatMap((member): Placement[] => {
    const desks = seats.filter(seat => seat.dataset.member === member.id);
    if (!desks.length) return [];
    const home = point(desks[0]);
    const meeting = meetings.find(item => item.memberIds.includes(member.id));
    const destination = meetingSeats.find(seat => seat.dataset.member === member.id && seat.dataset.officeMeetingSeat === meeting?.id);
    if (meeting && destination) return [{ member, home, points: [point(destination, 22, 8)], mode: "meeting", label: `会议：${meeting.title}` }];
    const queue = activeQueues.find(item => item.fromMemberId === member.id);
    if (queue) {
      const target = seats.find(seat => seat.dataset.member === queue.toMemberId)!;
      const waitingSeat = queueSeats.find(seat => seat.dataset.officeQueueSeat === queue.id);
      const targetPoint = waitingSeat ? point(waitingSeat, 22, 5) : point(target);
      return [{ member, home, points: [targetPoint], mode: "queue", label: `${queue.kind === "approval" ? "待审批" : "待阅批注"} · ${member.name}`, queueId: queue.id, recipient: point(target) }];
    }
    return [{ member, home, points: editing ? [home] : desks.map(desk => point(desk)), mode: !editing && desks.length > 1 ? "roaming" : "desk", label: member.name }];
  });
}

export function OfficePeople({ members, activity, scene, scale, paused, editing }: { members: OfficeMember[]; activity: OfficeWorkspace["activity"]; scene: RefObject<HTMLDivElement | null>; scale: number; paused: boolean; editing: boolean }) {
  const actors = useRef(new Map<string, HTMLDivElement>());
  const previous = useRef(new Map<string, Point>());
  const [placements, setPlacements] = useState<Placement[]>([]);
  useEffect(() => {
    const root = scene.current;
    if (!root) return;
    const arrange = () => {
      const next = placementsFor(root, members, activity, scale, editing);
      setPlacements(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    arrange();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(arrange);
    observer?.observe(root);window.addEventListener("resize", arrange);
    return () => { observer?.disconnect();window.removeEventListener("resize", arrange); };
  }, [members, activity, scene, scale, editing]);
  useLayoutEffect(() => {
    if (!placements.length) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let animations: Animation[] = [];
    const play = () => {
      animations.forEach(animation => animation.cancel());animations = [];
      for (const placement of placements) {
        const actor = actors.current.get(placement.member.id);
        if (!actor) continue;
        const target = placement.points[0];
        const origin = previous.current.get(placement.member.id) ?? placement.home;
        const transform = (point: Point) => `translate(${point.x}px, ${point.y}px)`;
        actor.style.transform = transform(target);
        previous.current.set(placement.member.id, target);
        if (paused || editing || motion?.matches || !actor.animate) continue;
        if (placement.mode === "roaming") {
          const path = [...placement.points, target].flatMap(point => [{ transform: transform(point), easing: "steps(18,end)" }, { transform: transform(point), easing: "steps(36,end)" }]);
          animations.push(actor.animate(path, { duration: Math.max(14_000, placement.points.length * 8_000), iterations: Infinity }));
        } else if (origin.x !== target.x || origin.y !== target.y) {
          animations.push(actor.animate([origin, { x: origin.x, y: target.y }, target].map(point => ({ transform: transform(point) })), { duration: 1600, easing: "steps(24,end)" }));
        }
      }
      previous.current = new Map([...previous.current].filter(([id]) => placements.some(item => item.member.id === id)));
    };
    play();motion?.addEventListener("change", play);
    return () => { animations.forEach(animation => animation.cancel());motion?.removeEventListener("change", play); };
  }, [placements, paused, editing]);
  return <div className={styles.people}>
    <svg className={styles.footsteps} aria-hidden="true">{placements.filter(item => item.mode === "queue").map(item => <path key={item.member.id} data-office-footsteps={item.queueId} d={`M ${item.home.x + 12} ${item.home.y + 36} V ${(item.recipient ?? item.points[0]).y + 36} H ${(item.recipient ?? item.points[0]).x + 12} V ${item.points[0].y + 36} H ${item.points[0].x + 12}`} />)}</svg>
    {placements.map(item => <div key={item.member.id} ref={node => { if (node) actors.current.set(item.member.id, node);else actors.current.delete(item.member.id); }} className={styles.actor} data-office-person={item.member.id} data-mode={item.mode} title={item.label}><PixelPerson name={item.member.name} color={item.member.style.deskColor} avatarUrl={item.member.style.avatarUrl} /></div>)}
  </div>;
}
