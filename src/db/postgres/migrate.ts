import {
  Migrator,
  type Kysely,
  type Migration,
  type MigrationProvider,
  type MigrationResult,
} from "kysely";
import * as securityFoundation from "./migrations/0001-security-foundation";

const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001_security_foundation": securityFoundation,
};

class PostgresMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...MIGRATIONS };
  }
}

function formatMigrationFailure(results: readonly MigrationResult[] | undefined): string {
  const failed = results?.find((result) => result.status === "Error");
  return failed ? `PostgreSQL migration ${failed.migrationName} failed.` : "PostgreSQL migration failed.";
}

export async function migratePostgresToLatest(database: Kysely<unknown>): Promise<void> {
  const migrator = new Migrator({
    db: database,
    provider: new PostgresMigrationProvider(),
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw new Error(formatMigrationFailure(results), { cause: error });
}
