import { randomUUID } from "node:crypto";

// Single-user, in-memory example. Hosted applications authorize the owner on
// upload, resolution, download and deletion, and retain accepted files.
const files = new Map();
export const maxFileBytes = 2_000_000;
export async function upload(request) {
  const fileName = decodeURIComponent(request.headers["x-file-name"] || "attachment");
  const mediaType = request.headers["x-file-type"] || "text/plain";
  if (!/^(text\/[a-z0-9.+-]+|application\/json|image\/(png|jpeg|webp|gif))$/i.test(mediaType)) {
    throw new Error("This example accepts text, JSON, PNG, JPEG, WebP and GIF files.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxFileBytes) throw new Error("Files must be at most 2 MB.");
    chunks.push(chunk);
  }
  const attachmentId = randomUUID();
  const receipt = { attachmentId, fileName: fileName.slice(0, 200), size };
  files.set(attachmentId, { receipt, mediaType, data: Buffer.concat(chunks), accepted: false });
  return receipt;
}
export function resolveFiles(ids = []) {
  if (!Array.isArray(ids) || ids.length > 10) throw new Error("Invalid attachments.");
  return ids.map(id => {
    const file = files.get(id);
    if (!file) throw new Error("An attached file is unavailable. Please attach it again.");
    return file;
  });
}
export function contentFor(file) {
  return file.mediaType.startsWith("image/")
    ? { type: "image", image: file.data, mediaType: file.mediaType }
    : { type: "text", text: `File: ${file.receipt.fileName}\n${file.data.toString("utf8")}` };
}
export function acceptFiles(selected) { for (const file of selected) file.accepted = true; }
export function removeFile(id) { if (!files.get(id)?.accepted) files.delete(id); }
export function download(response, id) {
  const [file] = resolveFiles([id]);
  response.writeHead(200, { "Content-Type": file.mediaType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.receipt.fileName)}` });
  response.end(file.data);
}
