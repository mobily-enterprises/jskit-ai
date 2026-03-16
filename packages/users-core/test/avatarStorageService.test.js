import assert from "node:assert/strict";
import test from "node:test";
import { createService, __testables } from "../src/server/accountProfile/avatarStorageService.js";

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

test("avatarStorageService builds stable storage key by user id", () => {
  assert.equal(__testables.buildAvatarStorageKey(7), "users/avatars/7/avatar");
  assert.throws(() => __testables.buildAvatarStorageKey(0), /positive integer user id/);
});

test("avatarStorageService detects common avatar mime types", () => {
  assert.equal(
    __testables.detectAvatarMimeTypeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xdb])),
    "image/jpeg"
  );
  assert.equal(
    __testables.detectAvatarMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png"
  );
  assert.equal(
    __testables.detectAvatarMimeTypeFromBuffer(
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0x11, 0x22, 0x33, 0x44, 0x57, 0x45, 0x42, 0x50])
    ),
    "image/webp"
  );
});

test("avatarStorageService saves, reads, and deletes avatar bytes", async () => {
  const storage = createStorageDouble();
  const avatarStorageService = createService({ storage });
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const saved = await avatarStorageService.saveAvatar({
    userId: 42,
    buffer: payload
  });
  assert.equal(saved.storageKey, "users/avatars/42/avatar");

  const loaded = await avatarStorageService.readAvatar(saved.storageKey);
  assert.equal(loaded?.mimeType, "image/png");
  assert.ok(Buffer.isBuffer(loaded?.buffer));
  assert.equal(loaded?.buffer?.toString("hex"), payload.toString("hex"));

  await avatarStorageService.deleteAvatar(saved.storageKey);
  const missing = await avatarStorageService.readAvatar(saved.storageKey);
  assert.equal(missing, null);
});
