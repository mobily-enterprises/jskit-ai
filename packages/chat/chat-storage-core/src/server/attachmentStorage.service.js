import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { resolveFsBasePath } from "@jskit-ai/server-runtime-core";

function normalizeStorageDriver(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || "fs";
}

function sanitizeFileName(fileName) {
  const source = String(fileName || "").trim();
  if (!source) {
    return "file";
  }

  const stripped = source.replace(/[\\/]/g, "_").replace(/\s+/g, " ").trim();

  return stripped || "file";
}

function normalizePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function buildAttachmentStorageKey({ threadId, attachmentId, fileName }) {
  const numericThreadId = normalizePositiveInteger(threadId, "threadId");
  const numericAttachmentId = normalizePositiveInteger(attachmentId, "attachmentId");
  const safeFileName = sanitizeFileName(fileName);
  const suffix = randomUUID();

  return `chat/threads/${numericThreadId}/attachments/${numericAttachmentId}/${suffix}-${safeFileName}`;
}

function createService(options = {}) {
  const driver = normalizeStorageDriver(options.driver);
  if (driver !== "fs") {
    throw new Error(`Unsupported CHAT_ATTACHMENT_STORAGE_DRIVER "${driver}". Supported: fs.`);
  }

  const fsBasePath = resolveFsBasePath(options.fsBasePath, {
    rootDir: options.rootDir || process.cwd()
  });

  const storage = createStorage({
    driver: fsDriver({
      base: fsBasePath
    })
  });

  async function init() {
    await mkdir(fsBasePath, { recursive: true });
  }

  async function saveAttachment({ threadId, attachmentId, fileName, buffer }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("Attachment buffer must be a Buffer instance.");
    }

    const storageKey = buildAttachmentStorageKey({
      threadId,
      attachmentId,
      fileName
    });

    await storage.setItemRaw(storageKey, buffer);
    return {
      storageKey
    };
  }

  async function readAttachment(storageKey) {
    const normalizedStorageKey = String(storageKey || "").trim();
    if (!normalizedStorageKey) {
      return null;
    }

    const value = await storage.getItemRaw(normalizedStorageKey);
    if (value == null) {
      return null;
    }

    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }

  async function deleteAttachment(storageKey) {
    const normalizedStorageKey = String(storageKey || "").trim();
    if (!normalizedStorageKey) {
      return;
    }

    await storage.removeItem(normalizedStorageKey);
  }

  return {
    driver,
    fsBasePath,
    init,
    saveAttachment,
    readAttachment,
    deleteAttachment
  };
}

const __testables = {
  normalizeStorageDriver,
  resolveFsBasePath,
  sanitizeFileName,
  buildAttachmentStorageKey
};

export { createService, __testables };
