import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface RawArtifactStore {
  put(contentHash: string, body: string): Promise<string>;
}

export class InMemoryRawArtifactStore implements RawArtifactStore {
  readonly artifacts = new Map<string, string>();
  async put(contentHash: string, body: string): Promise<string> {
    this.artifacts.set(contentHash, body);
    return `memory://${contentHash}`;
  }
}

export class FileRawArtifactStore implements RawArtifactStore {
  constructor(private readonly directory: string) {}
  async put(contentHash: string, body: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(contentHash) || digest(body) !== contentHash) throw new Error("Raw artifact integrity check failed.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const path = join(this.directory, `${contentHash}.xml`);
    try {
      await verifyArtifact(path, contentHash);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporaryPath = join(this.directory, `.${contentHash}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, path);
      await chmod(path, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyArtifact(path, contentHash);
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    return path;
  }
}

async function verifyArtifact(path: string, expectedHash: string): Promise<void> {
  if (digest(await readFile(path)) !== expectedHash) throw new Error("Raw artifact integrity check failed.");
}

function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
