import { inflateRawSync } from "node:zlib";
import type { ProjectDocumentKind } from "./document-policy";
import { extractDocumentText } from "./documents";

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 256;
const LIMIT_MESSAGE = "文档超过预览解压限制或 ZIP 结构无效，请下载原文件查看。";

export async function extractActivityDocumentPreview(kind: ProjectDocumentKind, bytes: Uint8Array) {
  if (kind === "docx") validateDocxExpansion(Buffer.from(bytes));
  return extractDocumentText(kind, bytes);
}

/** Validate actual inflation before mammoth/JSZip can allocate decompressed XML.
 * The strict directory/local-header checks keep both ZIP parsers on the same bytes.
 * Unsupported ZIP64, encrypted and multidisk archives remain downloadable.
 */
function validateDocxExpansion(bytes: Buffer) {
  try {
    const end = findEndRecord(bytes);
    const count = bytes.readUInt16LE(end + 10);
    const directorySize = bytes.readUInt32LE(end + 12);
    const directoryOffset = bytes.readUInt32LE(end + 16);
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > MAX_ENTRIES || directoryOffset + directorySize !== end) throw new Error(LIMIT_MESSAGE);
    let cursor = directoryOffset;
    let total = 0;
    const localOffsets = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error(LIMIT_MESSAGE);
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
      const local = bytes.readUInt32LE(cursor + 42);
      if (next > end || localOffsets.has(local)) throw new Error(LIMIT_MESSAGE);
      localOffsets.add(local);
      const actualSize = inflateEntry(bytes, cursor, directoryOffset, MAX_TOTAL_BYTES - total);
      total += actualSize;
      cursor = next;
    }
    if (cursor !== end) throw new Error(LIMIT_MESSAGE);
  } catch { throw new Error(LIMIT_MESSAGE); }
}

function findEndRecord(bytes: Buffer) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    if (offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) throw new Error(LIMIT_MESSAGE);
    return offset;
  }
  throw new Error(LIMIT_MESSAGE);
}

function inflateEntry(bytes: Buffer, central: number, directoryOffset: number, remaining: number) {
  const flags = bytes.readUInt16LE(central + 8);
  const method = bytes.readUInt16LE(central + 10);
  const compressedSize = bytes.readUInt32LE(central + 20);
  const declaredSize = bytes.readUInt32LE(central + 24);
  const nameLength = bytes.readUInt16LE(central + 28);
  const local = bytes.readUInt32LE(central + 42);
  if (bytes.readUInt16LE(central + 6) > 20 || bytes.readUInt16LE(central + 34) || flags & ~0x80e || ![0, 8].includes(method) || local + 30 > directoryOffset) throw new Error(LIMIT_MESSAGE);
  if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 26) !== nameLength) throw new Error(LIMIT_MESSAGE);
  const dataStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
  if (dataStart + compressedSize > directoryOffset || !bytes.subarray(local + 30, local + 30 + nameLength).equals(bytes.subarray(central + 46, central + 46 + nameLength))) throw new Error(LIMIT_MESSAGE);
  const limit = Math.min(MAX_ENTRY_BYTES, remaining);
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  // Never trust declaredSize as an allocation bound: forged ZIP sizes are common.
  const actualSize = method === 0 ? compressed.length : inflateRawSync(compressed, { maxOutputLength: Math.max(1, limit) }).length;
  if (actualSize > limit || actualSize !== declaredSize) throw new Error(LIMIT_MESSAGE);
  return actualSize;
}
