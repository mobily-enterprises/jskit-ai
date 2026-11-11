import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { readSingleMultipartFile } from "@jskit-ai/uploads-runtime/server/multipart/readSingleMultipartFile";
import { registerMultipartSupport } from "@jskit-ai/uploads-runtime/server/multipart/registerMultipartSupport";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import { createAccountProfileActions } from "../src/server/accountProfile/accountProfileActions.js";
import { registerAccountProfileRoutes } from "../src/server/accountProfile/accountProfileRoutes.js";
import { createService as createAccountProfileService } from "../src/server/accountProfile/accountProfileService.js";
import { createService as createAvatarService } from "../src/server/accountProfile/avatarService.js";
import { createService as createAvatarStorageService } from "../src/server/accountProfile/avatarStorageService.js";
import { DEFAULT_USER_SETTINGS } from "../src/shared/settings.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

// The account profile as an application serves it: users-core's profile, avatar and avatar storage services, its
// actions and its routes on Fastify with multipart support, with the profile, the settings and runtime.storage in
// memory, and the signed-in user 7.
async function profileApp(t) {
  const storedFiles = new Map();
  let profile = { id: 7, displayName: "Ada", email: "ada@example.test", avatarStorageKey: null, avatarVersion: null };
  const userProfilesRepository = {
    async findById() {
      return { ...profile };
    },
    async updateAvatarById(_userId, { avatarStorageKey, avatarVersion }) {
      profile = { ...profile, avatarStorageKey, avatarVersion };
      return { ...profile };
    }
  };
  const avatarService = createAvatarService({
    userProfilesRepository,
    avatarStorageService: createAvatarStorageService({
      storage: {
        async getItemRaw(key) {
          return storedFiles.get(key) ?? null;
        },
        async setItemRaw(key, value) {
          storedFiles.set(key, value);
        },
        async removeItem(key) {
          storedFiles.delete(key);
        }
      }
    })
  });
  const authService = { getCapabilities: () => ({}) };
  const accountProfileService = createAccountProfileService({
    userProfilesRepository,
    userSettingsRepository: {
      async ensureForUserId() {
        return { ...DEFAULT_USER_SETTINGS };
      }
    },
    authService,
    avatarService
  });

  const actions = createActionCatalogue();
  actions.register({ contributorId: "users.core", domain: "settings", actions: createAccountProfileActions({ accountProfileService }) });
  actions.registerContextContributor({ id: "test.actor", contribute: () => ({ actor: { id: "7" } }) });
  const router = createRouter();
  registerAccountProfileRoutes(router, { accountProfileService, authService, uploads: { readSingleMultipartFile } });

  const app = Fastify();
  t.after(() => app.close());
  await registerMultipartSupport(app);
  registerApiErrorHandler(app);
  registerRoutes(app, { routes: router.list(), actions });
  return { app, storedFiles };
}

test("saving a profile picture answers 200 with the account's plain settings", async (t) => {
  const { app, storedFiles } = await profileApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/api/settings/profile/avatar",
    headers: { "content-type": "multipart/form-data; boundary=jskit-avatar" },
    payload: Buffer.concat([
      Buffer.from(
        '--jskit-avatar\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n'
      ),
      PNG_BYTES,
      Buffer.from("\r\n--jskit-avatar--\r\n")
    ])
  });

  // Before, the route sent the action's JSON:API result where its schema and the upload read the plain settings:
  // the picture was saved, and serializing the answer failed with a 500.
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(storedFiles.get("users/avatars/7/avatar"), PNG_BYTES);
  const settings = response.json();
  assert.deepEqual(Object.keys(settings).sort(), ["notifications", "preferences", "profile", "security"]);
  assert.equal(settings.profile.displayName, "Ada");
  assert.equal(settings.profile.avatar.hasUploadedAvatar, true);
  assert.match(settings.profile.avatar.effectiveUrl, /^\/api\/settings\/profile\/avatar\?v=\d+$/u);
  assert.equal(settings.preferences.avatarSize, DEFAULT_USER_SETTINGS.avatarSize);
});
