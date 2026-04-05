import assert from "node:assert/strict";
import test from "node:test";
import {
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
} from "../src/server/storage/createUploadStorageService.js";

function createStorageDouble() {
  const values = new Map();
  return {
    async getItemRaw(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async setItemRaw(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    }
  };
}

test("normalizeStorageKey blocks unsafe paths", () => {
  assert.equal(normalizeStorageKey("uploads/test"), "uploads/test");
  assert.equal(normalizeStorageKey("/uploads/test"), "");
  assert.equal(normalizeStorageKey("../uploads/test"), "");
});

test("detectCommonMimeTypeFromBuffer recognizes common image types", () => {
  assert.equal(detectCommonMimeTypeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
  assert.equal(
    detectCommonMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png"
  );
});

test("createUploadStorageService saves, reads, and deletes raw bytes", async () => {
  const storage = createStorageDouble();
  const service = createUploadStorageService({ storage });
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const saved = await service.saveFile({
    storageKey: "uploads/images/face.png",
    buffer: payload
  });
  assert.equal(saved.storageKey, "uploads/images/face.png");

  const loaded = await service.readFile(saved.storageKey);
  assert.equal(loaded?.mimeType, "image/png");
  assert.equal(loaded?.buffer?.toString("hex"), payload.toString("hex"));

  await service.deleteFile(saved.storageKey);
  assert.equal(await service.readFile(saved.storageKey), null);
});
