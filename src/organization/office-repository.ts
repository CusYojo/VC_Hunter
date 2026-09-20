import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PublicDirectory } from "./contracts";
import { OfficeError, officeLayoutSchema, officeProfileSchema, officeStyleSchema, type OfficeActor, type OfficeStyle } from "./office-contracts";
import { readOfficeWorkspace } from "./office-read-model";
import { transaction } from "./repository";

export class OfficeRepository {
  constructor(readonly database: DatabaseSync) {}
  workspace(actor: OfficeActor, directory: PublicDirectory) {
    this.assertMember(actor, directory);
    return readOfficeWorkspace(this.database, actor, directory);
  }
  updateStyle(actor: OfficeActor, directory: PublicDirectory, raw: unknown): OfficeStyle {
    const input = officeStyleSchema.parse(raw);
    return transaction(this.database, () => {
      const current = this.workspace(actor, directory).members.find(member => member.id === actor.memberId)!.style;
      if (current.version !== input.expectedVersion) throw new OfficeError(409, "VERSION_CONFLICT", "工位已更新，请刷新后重试。");
      this.database.prepare(`INSERT INTO office_member_styles(tenant_id,member_id,desk_color,desk_shape,version) VALUES(?,?,?,?,2)
        ON CONFLICT(tenant_id,member_id) DO UPDATE SET desk_color=excluded.desk_color,desk_shape=excluded.desk_shape,version=office_member_styles.version+1`).run(actor.tenantId, actor.memberId, input.deskColor.toLowerCase(), input.deskShape);
      this.audit(actor, "office.style.updated", actor.memberId);
      return { ...current, deskColor: input.deskColor.toLowerCase(), deskShape: input.deskShape, version: current.version + 1 };
    });
  }
  updateProfile(actor: OfficeActor, directory: PublicDirectory, raw: unknown) {
    const input = officeProfileSchema.parse(raw);
    return transaction(this.database, () => {
      const current = this.workspace(actor, directory);
      const self = current.members.find(member => member.id === actor.memberId)!;
      if (self.profile.version !== input.expectedVersion) throw new OfficeError(409, "VERSION_CONFLICT", "个人展示已更新，请刷新后重试。");
      if (input.displayedProjectId && !self.projects.some(project => project.id === input.displayedProjectId)) throw new OfficeError(400, "INVALID_PROJECT", "只能展示自己参与的项目。");
      this.database.prepare(`INSERT INTO office_member_profiles(
          tenant_id,member_id,grouping_mode,displayed_project_id,description,presence_status,custom_status,version
        ) VALUES(?,?,?,?,?,?,?,2)
        ON CONFLICT(tenant_id,member_id) DO UPDATE SET grouping_mode=excluded.grouping_mode,
          displayed_project_id=excluded.displayed_project_id,description=excluded.description,
          presence_status=excluded.presence_status,custom_status=excluded.custom_status,
          version=office_member_profiles.version+1`).run(
        actor.tenantId, actor.memberId, input.groupingMode, input.displayedProjectId,
        input.description, input.presenceStatus, input.presenceStatus === "custom" ? input.customStatus : "",
      );
      this.audit(actor, "office.profile.updated", actor.memberId);
      return this.workspace(actor, directory);
    });
  }
  updateLayout(actor: OfficeActor, directory: PublicDirectory, raw: unknown) {
    if (!actor.canManage) throw new OfficeError(403, "FORBIDDEN", "仅管理员可调整工位布局。");
    const input = officeLayoutSchema.parse(raw);
    return transaction(this.database, () => {
      const current = this.workspace(actor, directory);
      if (current.layoutVersion !== input.expectedVersion) throw new OfficeError(409, "VERSION_CONFLICT", "办公室布局已更新，请刷新后重试。");
      this.validateDepartments(input.departments, directory);
      for (const setting of input.departments) this.database.prepare(`INSERT INTO office_department_settings(tenant_id,department_id,grouping_mode) VALUES(?,?,?)
        ON CONFLICT(tenant_id,department_id) DO UPDATE SET grouping_mode=excluded.grouping_mode`).run(actor.tenantId, setting.departmentId, setting.groupingMode);
      const updated = this.workspace(actor, directory);
      this.validateSeats(input.seats, updated.groups);
      for (const seat of input.seats) this.database.prepare(`INSERT INTO office_seats(tenant_id,group_id,member_id,x,y) VALUES(?,?,?,?,?)
        ON CONFLICT(tenant_id,group_id,member_id) DO UPDATE SET x=excluded.x,y=excluded.y`).run(actor.tenantId, seat.groupId, seat.memberId, seat.x, seat.y);
      this.database.prepare(`INSERT INTO office_layouts(tenant_id,version) VALUES(?,2)
        ON CONFLICT(tenant_id) DO UPDATE SET version=office_layouts.version+1`).run(actor.tenantId);
      this.audit(actor, "office.layout.updated", actor.tenantId);
      return this.workspace(actor, directory);
    });
  }
  private assertMember(actor: OfficeActor, directory: PublicDirectory) {
    if (!directory.members.some(member => member.id === actor.memberId && member.active && !member.isPlaceholder)) throw new OfficeError(403, "FORBIDDEN", "当前账号没有有效的员工档案。");
  }
  private validateDepartments(settings: Array<{ departmentId: string }>, directory: PublicDirectory) {
    if (new Set(settings.map(item => item.departmentId)).size !== settings.length || settings.some(item => !directory.departments.some(department => department.id === item.departmentId))) throw new OfficeError(400, "INVALID_DEPARTMENT", "部门不存在或重复。");
  }
  private validateSeats(seats: Array<{ groupId: string; memberId: string; x: number; y: number }>, groups: ReturnType<OfficeRepository["workspace"]>["groups"]) {
    const keys = seats.map(seat => `${seat.groupId}\u0000${seat.memberId}`);
    if (new Set(keys).size !== keys.length) throw new OfficeError(400, "INVALID_SEAT", "工位重复。");
    if (seats.some(seat => !groups.some(group => group.id === seat.groupId && group.seats.some(member => member.memberId === seat.memberId)))) throw new OfficeError(400, "INVALID_SEAT", "工位成员不属于此分组。");
    for (const group of groups) {
      const positions = group.seats.map(seat => seats.find(patch => patch.groupId === group.id && patch.memberId === seat.memberId) ?? seat).map(seat => `${seat.x}:${seat.y}`);
      if (new Set(positions).size !== positions.length) throw new OfficeError(409, "SEAT_OCCUPIED", "工位位置已被占用，请调整后保存。");
    }
  }
  private audit(actor: OfficeActor, action: string, target: string) {
    this.database.prepare("INSERT INTO office_audit(id,tenant_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), actor.tenantId, actor.memberId, action, target, new Date().toISOString());
  }
}
