import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { SCHEMA_SQL } from "./schema";
import { applyDatabaseMigrations } from "./migrations";

export function createDatabase(path: string): DatabaseSync {
  if (path === ":memory:") return new DatabaseSync(path);
  const directory = dirname(path);
  const directoryExisted = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Database directory must not be a symbolic link.");
  const directoryStats = statSync(directory);
  if (!directoryExisted || (directoryStats.mode & 0o077) !== 0) {
    if (typeof process.getuid === "function" && directoryStats.uid !== process.getuid()) throw new Error("Database directory must be owned by the service account.");
    chmodSync(directory, 0o700);
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Database path must not be a symbolic link.");
  const database = new DatabaseSync(path);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA synchronous = NORMAL;");
  chmodSync(path, 0o600);
  return database;
}

export function initializeDatabase(database: DatabaseSync): void {
  database.exec(SCHEMA_SQL);
  applyDatabaseMigrations(database);
}

const DATABASE_SYMBOL = Symbol.for("vc-hunter.database");
type DatabaseGlobal = typeof globalThis & { [DATABASE_SYMBOL]?: DatabaseSync };

export function getDatabase(): DatabaseSync {
  const databaseGlobal = globalThis as DatabaseGlobal;
  if (!databaseGlobal[DATABASE_SYMBOL]) {
    const path = process.env.VC_HUNTER_DB_PATH ?? join(process.cwd(), ".data", "vc-hunter.db");
    const database = createDatabase(path);
    initializeDatabase(database);
    databaseGlobal[DATABASE_SYMBOL] = database;
  }
  return databaseGlobal[DATABASE_SYMBOL];
}
