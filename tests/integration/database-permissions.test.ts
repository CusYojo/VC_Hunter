import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "@/db/client";

describe("database filesystem permissions", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  it("restricts the database and its parent directory to the service account", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vc-hunter-db-"));
    directories.push(parent);
    const directory = join(parent, "data");
    const path = join(directory, "vc-hunter.db");
    const database = createDatabase(path);
    database.close();

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("tightens an existing service-owned data directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vc-hunter-db-"));
    directories.push(parent);
    const directory = join(parent, "existing-data");
    await mkdir(directory, { mode: 0o755 });

    const database = createDatabase(join(directory, "vc-hunter.db"));
    database.close();

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });
});
