import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createAuthService, type AuthService } from "@/auth/service";

const serviceKey = Symbol.for("vc-hunter.auth-service");
type AuthGlobal = typeof globalThis & { [serviceKey]?: AuthService };

export function authDatabasePath() {
  const configured = process.env.VC_HUNTER_AUTH_DB_PATH;
  if (process.env.NODE_ENV === "production" && (!configured || !isAbsolute(configured))) {
    throw new Error("An absolute VC_HUNTER_AUTH_DB_PATH is required in production");
  }
  return resolve(configured || ".data/auth.db");
}

export function openAuthDatabase() {
  const path = authDatabasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Auth database must not be a symbolic link");
  const database = new DatabaseSync(path);
  chmodSync(path, 0o600);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return database;
}

export function getAuthService() {
  const scope = globalThis as AuthGlobal;
  if (scope[serviceKey]) return scope[serviceKey];
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL) throw new Error("BETTER_AUTH_SECRET and BETTER_AUTH_URL must be configured");
  const service = createAuthService({ database: openAuthDatabase(), baseURL, secret });
  scope[serviceKey] = service;
  return service;
}

export const getAuth = () => getAuthService().auth;
export const requireSession = (headers: Headers) => getAuthService().requireSession(headers);
export type { AuthenticatedSession, WorkspaceMembership } from "@/auth/service";
