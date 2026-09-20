import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDatabase } from "../src/db/client";
import { syncSourceManifest, type SourceManifest } from "../src/services/source-registration";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: npm run sources:sync -- <manifest.json>");
const contents = await readFile(resolve(manifestPath), "utf8");
const result = syncSourceManifest(getDatabase(), JSON.parse(contents) as SourceManifest);
process.stdout.write(`${JSON.stringify(result)}\n`);
