import { OperationAttachmentError, type OperationUpload } from "./business-operation-documents";

async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new OperationAttachmentError("请求过大，本次附件总大小不能超过 20 MB。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function readOperationInput(request: Request): Promise<{ input: unknown; files: OperationUpload[] }> {
  const multipart = request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data");
  const bytes = await readBody(request, multipart ? 21 * 1024 * 1024 : 300_000);
  if (!multipart) return { input: JSON.parse(bytes.toString("utf8")), files: [] };
  let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new OperationAttachmentError("附件上传格式无效，请重新选择文件。"); }
  if ([...form.keys()].some(key => !["payload", "files", "files[]"].includes(key))) throw new OperationAttachmentError("附件上传包含无效字段。");
  const payloads = form.getAll("payload");
  if (payloads.length !== 1 || typeof payloads[0] !== "string" || payloads[0].length > 300_000) throw new OperationAttachmentError("请提供一份有效的业务表单内容。");
  const entries = [...form.getAll("files"), ...form.getAll("files[]")];
  if (entries.length > 10) throw new OperationAttachmentError("每次最多上传 10 个附件。");
  if (entries.some(file => !(file instanceof File))) throw new OperationAttachmentError("附件上传格式无效，请重新选择文件。");
  const files = await Promise.all((entries as File[]).map(async file => ({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })));
  return { input: JSON.parse(payloads[0]), files };
}
