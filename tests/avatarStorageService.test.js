import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import { createService as createAvatarStorageService, __testables } from "../server/modules/users/avatarStorage.service.js";

test("avatar storage helpers normalize config and keys", () => {
  assert.equal(__testables.normalizePublicBasePath(""), "/uploads");
  assert.equal(__testables.normalizePublicBasePath("uploads"), "/uploads");
  assert.equal(__testables.normalizePublicBasePath("/uploads/"), "/uploads");
  assert.equal(__testables.normalizePublicBasePath("/"), "/uploads");

  assert.equal(__testables.resolveFsBasePath("", { rootDir: "/tmp/app" }), path.resolve("/tmp/app", "data", "storage"));
  assert.equal(__testables.resolveFsBasePath("/tmp/custom", { rootDir: "/tmp/app" }), path.resolve("/tmp/custom"));

  assert.equal(__testables.normalizeStorageKey(7), "avatars/users/7/avatar.webp");
  assert.throws(() => __testables.normalizeStorageKey(0), /positive integer user id/);
  assert.throws(() => __testables.normalizeStorageKey("x"), /positive integer user id/);

  assert.equal(__testables.encodePathSegments("avatars/users/7/avatar.webp"), "avatars/users/7/avatar.webp");
});

test("avatar storage service saves, serves and deletes raw avatar content", async () => {
  const basePath = path.join(process.cwd(), ".tmp-avatar-storage-test");
  await fs.rm(basePath, { recursive: true, force: true });

  const service = createAvatarStorageService({
    driver: "fs",
    fsBasePath: basePath,
    publicBasePath: "/uploads"
  });

  await service.init();

  const registrations = [];
  const fakeFastifyStatic = () => {};
  const fakeApp = {
    async register(plugin, options) {
      registrations.push({ plugin, options });
    }
  };

  await service.registerDelivery(fakeApp, {
    fastifyStatic: fakeFastifyStatic
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].plugin, fakeFastifyStatic);
  assert.equal(registrations[0].options.root, basePath);
  assert.equal(registrations[0].options.prefix, "/uploads/");
  assert.equal(registrations[0].options.decorateReply, false);

  const saved = await service.saveAvatar({
    userId: 7,
    buffer: Buffer.from("avatar-bytes"),
    avatarVersion: 123
  });

  assert.equal(saved.storageKey, "avatars/users/7/avatar.webp");
  assert.equal(saved.publicUrl, "/uploads/avatars/users/7/avatar.webp?v=123");
  assert.equal(
    service.toPublicUrl(saved.storageKey, saved.avatarVersion),
    "/uploads/avatars/users/7/avatar.webp?v=123"
  );

  const savedPath = path.join(basePath, saved.storageKey);
  await fs.access(savedPath);

  await service.deleteAvatar(saved.storageKey);
  await assert.rejects(() => fs.access(savedPath));

  await service.deleteAvatar(null);
  await fs.rm(basePath, { recursive: true, force: true });
});

test("avatar storage service validates unsupported driver and buffer payload", async () => {
  assert.throws(() => createAvatarStorageService({ driver: "s3" }), /Unsupported AVATAR_STORAGE_DRIVER/);

  const service = createAvatarStorageService({
    driver: "fs",
    fsBasePath: path.join(process.cwd(), ".tmp-avatar-storage-test-buffer")
  });

  await service.init();
  await assert.rejects(
    () => service.saveAvatar({ userId: 3, buffer: "not-buffer", avatarVersion: 1 }),
    /Buffer instance/
  );
  await assert.rejects(
    () => service.registerDelivery(null, {}),
    /requires a Fastify app instance/
  );
  await assert.rejects(
    () => service.registerDelivery({ register: async () => {} }, {}),
    /requires fastifyStatic plugin/
  );
  await fs.rm(service.fsBasePath, { recursive: true, force: true });
});
