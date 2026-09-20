import type { DatabaseSync } from "node:sqlite";
import { OrganizationRepository } from "./repository";
import { bulkImport } from "./bulk-import";
import type { OrganizationRoster } from "./contracts";

export function createOrganizationService(database: DatabaseSync, getPasswordHasher: () => Promise<{ hash: (password: string) => Promise<string> }>) {
  const repository = new OrganizationRepository(database);
  return {
    directory: repository.directory.bind(repository), publicDirectory: repository.publicDirectory.bind(repository),
    assertAdmin: repository.assertAdmin.bind(repository), createDepartment: repository.createDepartment.bind(repository),
    updateDepartment: repository.updateDepartment.bind(repository), updateMember: repository.updateMember.bind(repository),
    bulkImport: async (roster: OrganizationRoster, password: string, options?: { allowShortPassword?: boolean }) => bulkImport(repository, await getPasswordHasher(), roster, password, options),
  };
}
