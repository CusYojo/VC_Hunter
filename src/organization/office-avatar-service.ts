import type { DatabaseSync } from "node:sqlite";
import type { Directory, OrganizationActor } from "./contracts";
import { OfficeError, type OfficeActor } from "./office-contracts";
import { normalizeAvatarPng } from "./office-avatar";
import { officeAvatarReviewSchema, type AvatarReviewInput } from "./office-avatar-contracts";
import { OfficeAvatarRepository } from "./office-avatar-repository";

export type AvatarOrganization = { directory: (tenantId: string) => Directory; assertAdmin: (actor: OrganizationActor) => void };
export function createOfficeAvatarService(database: DatabaseSync, organization: AvatarOrganization) {
  const repository = new OfficeAvatarRepository(database);
  function authorize(actor: OfficeActor, admin = false) {
    const directory = organization.directory(actor.tenantId);
    const self = directory.members.find(member => member.id === actor.memberId && member.accountId === actor.accountId && member.active && !member.isPlaceholder);
    if (!self) throw new OfficeError(403, "FORBIDDEN", "当前账号不是有效组织成员。");
    const verified = { ...actor, canManage: self.roles.includes("org_admin") };
    if (admin) {
      if (!verified.canManage) throw new OfficeError(403, "FORBIDDEN", "仅管理员可审核头像。");
      organization.assertAdmin(actor);
    }
    return { actor: verified, self, directory, names: new Map(directory.members.map(member => [member.id, member.name])) };
  }
  return {
    async submit(actor: OfficeActor, bytes: Uint8Array, key?: string) {
      authorize(actor);
      const png = await normalizeAvatarPng(bytes);
      const verified = authorize(actor);
      const admins = verified.directory.members.filter(member => member.active && !member.isPlaceholder && member.accountId && member.roles.includes("org_admin")).map(member => member.id);
      return repository.submit(verified.actor, png, verified.self.name, admins, key);
    },
    latest(actor: OfficeActor) { const verified = authorize(actor); return repository.latest(verified.actor, verified.self.name); },
    list(actor: OfficeActor) { const verified = authorize(actor, true); return repository.list(verified.actor, verified.names); },
    read(actor: OfficeActor, id: string) { return repository.read(authorize(actor).actor, id); },
    review(actor: OfficeActor, id: string, input: AvatarReviewInput, key?: string) {
      const verified = authorize(actor, true);
      return repository.review(verified.actor, id, officeAvatarReviewSchema.parse(input), verified.names, key);
    },
  };
}
export type OfficeAvatarService = ReturnType<typeof createOfficeAvatarService>;
