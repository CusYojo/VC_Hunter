import { getDatabase } from "../src/db/client";
import { seedDemoData } from "../src/db/seed";

const configuredPath = process.env.VC_HUNTER_DB_PATH ?? "";
if (process.env.NODE_ENV === "production" || process.env.VC_HUNTER_ENVIRONMENT === "production" || /(?:^|[\/_-])prod(?:uction)?(?:[\/_-]|$)/iu.test(configuredPath)) {
  throw new Error("Demo seeding is disabled for production environments and production-marked database paths.");
}
const database = getDatabase();
seedDemoData(database);
const row = database.prepare("SELECT count(*) AS count FROM projects").get() as { count: number };
console.log(`Seeded ${row.count} demo projects into the local evidence database.`);
