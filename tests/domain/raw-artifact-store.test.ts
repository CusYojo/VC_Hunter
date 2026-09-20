import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRawArtifactStore } from "@/connectors/raw-artifact-store";

describe("raw artifact store", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  it("publishes a verified artifact atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vc-hunter-raw-"));
    directories.push(directory);
    const body = "<rss>evidence</rss>";
    const hash = createHash("sha256").update(body).digest("hex");

    const path = await new FileRawArtifactStore(directory).put(hash, body);

    expect(await readFile(path, "utf8")).toBe(body);
    expect((await readdir(directory)).every((name) => !name.endsWith(".tmp"))).toBe(true);
  });

  it("rejects an existing artifact whose bytes do not match its hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vc-hunter-raw-"));
    directories.push(directory);
    const body = "<rss>evidence</rss>";
    const hash = createHash("sha256").update(body).digest("hex");
    await writeFile(join(directory, `${hash}.xml`), "corrupt");

    await expect(new FileRawArtifactStore(directory).put(hash, body)).rejects.toThrow(/integrity/i);
  });
});
