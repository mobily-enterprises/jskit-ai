import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import sharp from "sharp";
import { AppError } from "../lib/errors.js";
import { createUserAvatarService, __testables } from "../services/userAvatarService.js";

function createProfile(overrides = {}) {
  return {
    id: 7,
    supabaseUserId: "supabase-7",
    email: "user@example.com",
    displayName: "user",
    avatarStorageKey: null,
    avatarVersion: null,
    avatarUpdatedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("user avatar helpers cover normalization and gravatar url construction", async () => {
  assert.equal(__testables.normalizeUploadDimension(256), 256);
  assert.equal(__testables.normalizeUploadDimension(999), 256);

  assert.equal(__testables.normalizeAvatarSize(80), 80);
  assert.equal(__testables.normalizeAvatarSize(8), 32);
  assert.equal(__testables.normalizeAvatarSize(999), 128);
  assert.equal(__testables.normalizeAvatarSize("bad"), 64);

  assert.equal(__testables.normalizeEmailForHash(" User@Example.com "), "user@example.com");
  const gravatarUrl = __testables.createGravatarUrl("user@example.com", 80);
  assert.ok(gravatarUrl.startsWith("https://www.gravatar.com/avatar/"));
  assert.ok(gravatarUrl.endsWith("d=mp&s=80"));

  const buffer = await __testables.readAvatarBuffer(Readable.from([Buffer.from("ok")]), { maxBytes: 8 });
  assert.equal(buffer.toString(), "ok");

  await assert.rejects(() => __testables.readAvatarBuffer(Readable.from([Buffer.alloc(9)]), { maxBytes: 8 }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, "Validation failed.");
    assert.equal(Boolean(error.details?.fieldErrors?.avatar?.includes("Maximum allowed size")), true);
    return true;
  });
  await assert.rejects(() => __testables.readAvatarBuffer(Readable.from([]), { maxBytes: 8 }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, "Validation failed.");
    assert.equal(error.details?.fieldErrors?.avatar, "Avatar file is empty.");
    return true;
  });
});

test("user avatar service uploads and clears avatars", async () => {
  const calls = [];

  const service = createUserAvatarService({
    userProfilesRepository: {
      async updateAvatarById(userId, avatar) {
        calls.push(["updateAvatarById", userId, avatar.avatarStorageKey, avatar.avatarVersion]);
        return createProfile({
          id: userId,
          avatarStorageKey: avatar.avatarStorageKey,
          avatarVersion: String(avatar.avatarVersion),
          avatarUpdatedAt: avatar.avatarUpdatedAt.toISOString()
        });
      },
      async findBySupabaseUserId(supabaseUserId) {
        calls.push(["findBySupabaseUserId", supabaseUserId]);
        return createProfile({
          avatarStorageKey: "avatars/users/7/avatar.webp",
          avatarVersion: "999"
        });
      },
      async clearAvatarById(userId) {
        calls.push(["clearAvatarById", userId]);
        return createProfile({ id: userId });
      }
    },
    avatarStorageService: {
      toPublicUrl(storageKey, version) {
        return storageKey ? `/uploads/${storageKey}?v=${version}` : null;
      },
      async saveAvatar({ userId, buffer, avatarVersion }) {
        calls.push(["saveAvatar", userId, buffer.length, avatarVersion]);
        return {
          storageKey: `avatars/users/${userId}/avatar.webp`,
          avatarVersion: String(avatarVersion)
        };
      },
      async deleteAvatar(storageKey) {
        calls.push(["deleteAvatar", storageKey]);
      }
    }
  });

  const sourceImage = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  })
    .png()
    .toBuffer();

  const uploaded = await service.uploadForUser(
    {
      id: 7,
      supabaseUserId: "supabase-7",
      email: "user@example.com"
    },
    {
      stream: Readable.from([sourceImage]),
      mimeType: "image/png",
      uploadDimension: 128
    }
  );

  assert.equal(uploaded.profile.avatarStorageKey, "avatars/users/7/avatar.webp");
  assert.equal(uploaded.image.mimeType, "image/webp");
  assert.ok(uploaded.image.bytes > 0);

  const cleared = await service.clearForUser({
    id: 7,
    supabaseUserId: "supabase-7"
  });
  assert.equal(cleared.avatarStorageKey, null);

  const avatarModel = service.buildAvatarResponse(createProfile(), { avatarSize: 72 });
  assert.equal(avatarModel.hasUploadedAvatar, false);
  assert.equal(avatarModel.size, 72);
  assert.ok(calls.some((entry) => entry[0] === "saveAvatar"));
  assert.ok(calls.some((entry) => entry[0] === "deleteAvatar"));
});

test("user avatar service maps validation and not-found branches", async () => {
  const service = createUserAvatarService({
    userProfilesRepository: {
      async updateAvatarById() {
        throw new Error("not used");
      },
      async findBySupabaseUserId() {
        return null;
      },
      async clearAvatarById() {
        throw new Error("not used");
      }
    },
    avatarStorageService: {
      toPublicUrl() {
        return null;
      },
      async saveAvatar() {
        throw new Error("not used");
      },
      async deleteAvatar() {}
    }
  });

  await assert.rejects(
    () =>
      service.uploadForUser(
        { id: 7, supabaseUserId: "supabase-7", email: "user@example.com" },
        {
          stream: Readable.from([Buffer.from("abc")]),
          mimeType: "text/plain",
          uploadDimension: 128
        }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.avatar.includes("must be one of"), true);
      return true;
    }
  );

  await assert.rejects(
    () => service.clearForUser({ id: 7, supabaseUserId: "missing" }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 404);
      return true;
    }
  );
});
