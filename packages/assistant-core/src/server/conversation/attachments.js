import path from "node:path";
import { conversationAttachmentManifest } from "../../shared/conversation/attachments.js";

function invalid(message) {
  return Object.assign(new Error(message), { code: "conversation_invalid_attachments", statusCode: 400 });
}

export function conversationAttachmentIds(value = []) {
  if (!Array.isArray(value) || value.length > 10 || value.some(id => typeof id !== "string" || !id.trim() || id.length > 256) ||
      new Set(value).size !== value.length) {
    throw invalid("Attachments require at most ten distinct, nonempty attachment IDs.");
  }
  return [...value];
}

/** Resolve app-owned files for one dispatch. Only receipts enter the transcript. */
export function createConversationAttachmentReader({ attachments, context, conversationId, signal, authorize, types, maximumBytes }) {
  let bytes = 0;
  return async references => {
    if (!references?.length) return { attachments: [], content: [], localFiles: [], attachmentManifest: "" };
    if (typeof attachments?.resolve !== "function") {
      throw Object.assign(new Error("File attachments are not configured for this conversation."), { code: "conversation_unsupported", statusCode: 400 });
    }
    const receipts = [];
    const content = [];
    const localFiles = [];
    // Continuity may retain files from several earlier messages. Each resolver
    // call uses the same bounded batch as a new user message.
    for (let offset = 0; offset < references.length; offset += 10) {
      const attachmentIds = conversationAttachmentIds(references.slice(offset, offset + 10).map(file => file.attachmentId));
      signal.throwIfAborted();
      await authorize();
      const resolved = await attachments.resolve({ attachmentIds, context, conversationId, signal });
      signal.throwIfAborted();
      const local = resolved?.localFiles !== undefined;
      if (!Array.isArray(resolved?.attachments) || resolved.attachments.length !== attachmentIds.length ||
          (local ? !Array.isArray(resolved.localFiles) || resolved.localFiles.length !== attachmentIds.length ||
            resolved.content !== undefined && (!Array.isArray(resolved.content) || resolved.content.length)
            : !Array.isArray(resolved.content) || !resolved.content.length || resolved.content.length > 100)) {
        throw invalid("The attachment resolver must return a receipt for every requested file and bounded model content.");
      }
      if (local && !types.includes("localFile")) {
        throw invalid("This engine cannot accept local attachment files. Supply extracted text or supported image bytes.");
      }
      for (const [index, receipt] of resolved.attachments.entries()) {
        if (receipt?.attachmentId !== attachmentIds[index] || typeof receipt.fileName !== "string" || !receipt.fileName.trim() ||
            receipt.fileName.length > 256 || !Number.isSafeInteger(receipt.size) || receipt.size < 0 ||
            receipt.reference !== undefined && (typeof receipt.reference !== "string" || receipt.reference.length > 256)) {
          throw invalid("Attachment receipts require the requested ID, a bounded fileName and a nonnegative size.");
        }
        receipts.push({ attachmentId: receipt.attachmentId, fileName: receipt.fileName, size: receipt.size,
          ...(receipt.reference ? { reference: receipt.reference } : {}) });
        if (local) {
          const file = resolved.localFiles[index];
          if (file?.attachmentId !== receipt.attachmentId || file.fileName !== receipt.fileName || file.size !== receipt.size ||
              typeof receipt.reference !== "string" || !receipt.reference.trim() || file.reference !== receipt.reference ||
              typeof file.path !== "string" || !path.isAbsolute(file.path) || file.path.includes("\0") ||
              typeof file.contentType !== "string" || !/^[\w.+-]+\/[\w.+-]+$/u.test(file.contentType)) {
            throw invalid("Local attachment files require their exact requested receipt and an authorized absolute native path.");
          }
          localFiles.push({ attachmentId: file.attachmentId, fileName: file.fileName, size: file.size,
            reference: file.reference, contentType: file.contentType, path: file.path });
        }
      }
      for (const part of resolved.content || []) {
        if (!types.includes(part?.type)) throw invalid("This engine cannot accept that attachment format. Supply extracted text or a supported image.");
        if (part.type === "text") {
          if (typeof part.text !== "string" || !part.text.trim()) throw invalid("Attachment text must be nonempty.");
          bytes += Buffer.byteLength(part.text);
          content.push({ type: "text", text: part.text });
        } else {
          const data = part.type === "image" ? part.image : part.data;
          if (!(data instanceof Uint8Array) || !data.byteLength || typeof part.mediaType !== "string" ||
              !/^[\w.+-]+\/[\w.+-]+$/u.test(part.mediaType) ||
              part.type === "image" && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(part.mediaType) ||
              part.filename !== undefined && (typeof part.filename !== "string" || part.filename.length > 256)) {
            throw invalid("Attachments require authorized bytes and a supported media type; remote URLs and paths are not accepted.");
          }
          bytes += data.byteLength;
          if (bytes > maximumBytes) throw invalid("Attachment content exceeds the configured byte limit for this request.");
          content.push(part.type === "image" ? { type: "image", image: Buffer.from(data), mediaType: part.mediaType }
            : { type: "file", data: Buffer.from(data), mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) });
        }
        if (bytes > maximumBytes) throw invalid("Attachment content exceeds the configured byte limit for this request.");
      }
    }
    const attachmentManifest = conversationAttachmentManifest(localFiles);
    bytes += Buffer.byteLength(attachmentManifest);
    if (bytes > maximumBytes) throw invalid("Attachment content exceeds the configured byte limit for this request.");
    await authorize();
    return { attachments: receipts, content, localFiles, attachmentManifest };
  };
}
