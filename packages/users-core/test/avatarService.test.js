import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createService } from "../src/server/accountProfile/avatarService.js";

function createRepositoryDouble(initialProfile) {
  const state = {
    profile: { ...initialProfile }
  };

  return {
    state,
    async findByIdentity() {
      return { ...state.profile };
    },
    async findById() {
      return { ...state.profile };
    },
    async updateAvatarById(userId, avatar = {}) {
      state.profile = {
        ...state.profile,
        id: Number(userId),
        avatarStorageKey: avatar.avatarStorageKey || null,
        avatarVersion: avatar.avatarVersion == null ? null : String(avatar.avatarVersion)
      };
      return { ...state.profile };
    },
    async clearAvatarById(userId) {
      state.profile = {
        ...state.profile,
        id: Number(userId),
        avatarStorageKey: null,
        avatarVersion: null
      };
      return { ...state.profile };
    }
  };
}

test("avatarService uploadForUser stores bytes and updates profile avatar fields", async () => {
  const repository = createRepositoryDouble({
    id: 7,
    authProvider: "local",
    authProviderUserSid: "u-7",
    email: "test@example.com",
    displayName: "Tester",
    avatarStorageKey: null,
    avatarVersion: null
  });

  const savedPayloads = [];
  const avatarStorageService = {
    async saveAvatar(payload) {
      savedPayloads.push(payload);
      return {
        storageKey: "users/avatars/7/avatar"
      };
    }
  };

  const avatarService = createService({
    usersRepository: repository,
    avatarStorageService
  });

  const user = {
    authProvider: "local",
    authProviderUserSid: "u-7"
  };

  const result = await avatarService.uploadForUser(user, {
    mimeType: "image/png",
    stream: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47])])
  });

  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].userId, 7);
  assert.ok(Buffer.isBuffer(savedPayloads[0].buffer));
  assert.equal(result.profile.avatarStorageKey, "users/avatars/7/avatar");
  assert.equal(typeof result.profile.avatarVersion, "string");
});

test("avatarService clearForUser removes stored avatar and clears profile fields", async () => {
  const repository = createRepositoryDouble({
    id: 7,
    authProvider: "local",
    authProviderUserSid: "u-7",
    email: "test@example.com",
    displayName: "Tester",
    avatarStorageKey: "users/avatars/7/avatar",
    avatarVersion: "123"
  });

  const deletedKeys = [];
  const avatarStorageService = {
    async deleteAvatar(storageKey) {
      deletedKeys.push(storageKey);
    }
  };

  const avatarService = createService({
    usersRepository: repository,
    avatarStorageService
  });

  const profile = await avatarService.clearForUser({
    authProvider: "local",
    authProviderUserSid: "u-7"
  });

  assert.deepEqual(deletedKeys, ["users/avatars/7/avatar"]);
  assert.equal(profile.avatarStorageKey, null);
  assert.equal(profile.avatarVersion, null);
});
