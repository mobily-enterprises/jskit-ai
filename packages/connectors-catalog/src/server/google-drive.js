import { randomUUID } from "node:crypto";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { googleDriveDefinition } from "../shared/google.js";
import { googleOperation, googleRead, googleProvider, pageToken } from "./google.js";
const origin = "https://www.googleapis.com";
const fileId = { type: "string", required: true, minLength: 1, maxLength: 1024, validator: value => /^[A-Za-z0-9_-]+$/.test(value) || "Use a Drive file ID, not a URL." };
const contentScopes = ["drive", "drive.file", "drive.readonly"];
const writeScopes = ["drive", "drive.file"];
const validFile = value => typeof value?.id === "string";
const validBytes = value => typeof value?.bodyBase64 === "string" && Number.isInteger(value.size) && typeof value.contentType === "string";
const fields = "id,name,mimeType,parents,size,trashed,webViewLink,capabilities,exportLinks";
function url(fileId, query = {}, suffix = "") {
  const address = new URL(`${origin}/drive/v3/files${fileId ? `/${encodeURIComponent(fileId)}` : ""}${suffix}`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) address.searchParams.set(key, String(value));
  return address.href;
}
const baseProvider = googleProvider(googleDriveDefinition, origin, "files.list", {
  "files.get": googleRead([...contentScopes, "drive.metadata", "drive.metadata.readonly"], { fileId }, ({ fileId }) => ({ url: url(fileId, { supportsAllDrives: true, fields }) }), validFile),
  "files.download": googleRead(contentScopes, { fileId }, ({ fileId }) => ({ url: url(fileId, { supportsAllDrives: true, alt: "media" }) }), validBytes),
  "files.export": googleRead(contentScopes, { fileId, mimeType: { type: "string", required: true, minLength: 1, maxLength: 200 } }, ({ fileId, mimeType }) => ({ url: url(fileId, { mimeType }, "/export") }), validBytes),
  "files.create": googleOperation(writeScopes, { name: { type: "string", required: true, minLength: 1, maxLength: 1024 }, parentId: { ...fileId, required: false }, folder: { type: "boolean", defaultTo: false } }, ({ name, parentId, folder }) => ({ method: "POST", url: url(undefined, { supportsAllDrives: true, fields }), body: { name, ...(parentId ? { parents: [parentId] } : {}), ...(folder ? { mimeType: "application/vnd.google-apps.folder" } : {}) } }), validFile),
  "files.update": googleOperation([...writeScopes, "drive.metadata"], { fileId, name: { type: "string", minLength: 1, maxLength: 1024 }, description: { type: "string", maxLength: 16384 }, trashed: { type: "boolean" } }, ({ fileId, ...body }) => {
    if (!Object.keys(body).length) throw Object.assign(new Error("Supply a name, description or trashed value."), { statusCode: 422 });
    return { method: "PATCH", url: url(fileId, { supportsAllDrives: true, fields }), body };
  }, validFile),
  "files.upload": googleOperation(writeScopes, {
    fileId: { ...fileId, required: false }, name: { type: "string", required: true, minLength: 1, maxLength: 1024 },
    parentId: { ...fileId, required: false }, contentType: { type: "string", required: true, minLength: 3, maxLength: 200 },
    bodyBase64: { type: "string", required: true, maxLength: 6666668, noTrim: true }
  }, ({ fileId, name, parentId, contentType, bodyBase64 }) => {
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType)) throw Object.assign(new Error("Use a MIME type without header parameters."), { statusCode: 422 });
    const data = Buffer.from(bodyBase64, "base64");
    if (data.toString("base64") !== bodyBase64) throw Object.assign(new Error("Use standard padded base64 file data."), { statusCode: 422 });
    if (data.byteLength > 5_000_000) throw Object.assign(new Error("Uploads above 5 MB require the framework's native resumable client."), { statusCode: 413 });
    if (fileId && parentId) throw Object.assign(new Error("parentId applies to new files; moving files requires native addParents/removeParents wiring."), { statusCode: 422 });
    const boundary = `drive_${randomUUID()}`;
    const metadata = { name, ...(parentId ? { parents: [parentId] } : {}) };
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return { method: fileId ? "PATCH" : "POST", url: url(fileId, { uploadType: "multipart", supportsAllDrives: true, fields }).replace("/drive/v3/", "/upload/drive/v3/"), headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body };
  }, validFile),
  "files.list": googleRead(["drive", "drive.file", "drive.metadata", "drive.metadata.readonly", "drive.readonly", "drive.meet.readonly", "drive.photos.readonly"], {
    pageToken, pageSize: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
    q: { type: "string", maxLength: 8192 },
    driveId: { type: "string", minLength: 1, maxLength: 1024 }
  }, ({ driveId, ...query }) => ({ url: `${origin}/drive/v3/files`, query: {
    ...query, fields: "kind,nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime)",
    ...(driveId ? { driveId, corpora: "drive", supportsAllDrives: true, includeItemsFromAllDrives: true } : {})
  } }), (value) => value?.kind === "drive#fileList" && (value.files === undefined || Array.isArray(value.files)))
});
const googleDriveProvider = Object.freeze({ ...baseProvider,
  async exchange(address, options, { request, fetchImpl }) {
    const target = new URL(address);
    const upload = target.pathname.startsWith("/upload/drive/v3/");
    const download = target.searchParams.get("alt") === "media" || target.pathname.endsWith("/export");
    if (!upload && !download) return request(address, options);
    const response = await fetchImpl(address, { ...options, credentials: "omit", redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("Google Drive transfer failed."), { status: response.status }); }
    const chunks = []; let size = 0;
    const reader = response.body?.getReader();
    if (reader) try { while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ConnectorError("connector_response_too_large", "Use the framework's native Drive client for downloads or exports above 8 MiB.", { statusCode: 413 }); }
      chunks.push(value);
    } } finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks);
    if (upload) return JSON.parse(body.toString("utf8"));
    return { bodyBase64: body.toString("base64"), contentType: response.headers.get("content-type") || "application/octet-stream", size };
  }
});
export { googleDriveProvider };
