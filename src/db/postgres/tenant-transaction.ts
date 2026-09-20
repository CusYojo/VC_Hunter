import { sql, type Kysely, type Transaction } from "kysely";

const TENANT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function validateTenantIdentifier(tenantId: string): void {
  if (!TENANT_IDENTIFIER_PATTERN.test(tenantId)) {
    throw new Error("Tenant identifier is invalid.");
  }
}

export async function runInTenantTransaction<Database, Result>(
  database: Kysely<Database>,
  tenantId: string,
  operation: (transaction: Transaction<Database>) => Promise<Result>,
): Promise<Result> {
  validateTenantIdentifier(tenantId);

  return database.transaction().execute(async (transaction) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`.execute(transaction);
    return operation(transaction);
  });
}
