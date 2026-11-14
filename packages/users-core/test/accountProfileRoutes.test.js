import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { StorageProvider } from "@jskit-ai/storage-runtime/server/providers/StorageProvider";
import { readSingleMultipartFile } from "@jskit-ai/uploads-runtime/server/multipart/readSingleMultipartFile";
import { registerMultipartSupport } from "@jskit-ai/uploads-runtime/server/multipart/registerMultipartSupport";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import { startS3StandIn } from "../../storage-runtime/test/support/s3StandIn.js";
import { createAccountProfileActions } from "../src/server/accountProfile/accountProfileActions.js";
import { registerAccountProfileRoutes } from "../src/server/accountProfile/accountProfileRoutes.js";
import { createService as createAccountProfileService } from "../src/server/accountProfile/accountProfileService.js";
import { createService as createAvatarService } from "../src/server/accountProfile/avatarService.js";
import { createService as createAvatarStorageService } from "../src/server/accountProfile/avatarStorageService.js";
import { DEFAULT_USER_SETTINGS } from "../src/shared/settings.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const S3_BUCKET = Object.freeze({
  bucket: "jskit-files",
  region: "eu-west-1",
  accessKeyId: "AKIASTANDIN",
  secretAccessKey: `stand-in-secret-${randomUUID()}`
});

// The account profile as an application serves it: users-core's profile, avatar and avatar storage services, its
// actions and its routes on Fastify with multipart support, with the profile and the settings in memory,
// runtime.storage in memory unless the test gives one, and the signed-in user 7. The app logs to `logStream` when
// one is given.
async function profileApp(t, { storage, logStream } = {}) {
  const storedFiles = new Map();
  let profile = { id: 7, displayName: "Ada", email: "ada@example.test", avatarStorageKey: null, avatarVersion: null };
  const userProfilesRepository = {
    async findById() {
      return { ...profile };
    },
    async updateAvatarById(_userId, { avatarStorageKey, avatarVersion }) {
      profile = { ...profile, avatarStorageKey, avatarVersion };
      return { ...profile };
    },
    async clearAvatarById() {
      profile = { ...profile, avatarStorageKey: null, avatarVersion: null };
      return { ...profile };
    }
  };
  const avatarService = createAvatarService({
    userProfilesRepository,
    avatarStorageService: createAvatarStorageService({
      storage: storage ?? {
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

  const app = Fastify(logStream ? { logger: { level: "info", stream: logStream } } : {});
  t.after(() => app.close());
  // Routes that run no action read the signed-in user from the request, as authentication sets it.
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    request.user = { id: "7" };
  });
  await registerMultipartSupport(app);
  registerApiErrorHandler(app);
  registerRoutes(app, { routes: router.list(), actions });
  return { app, storedFiles };
}

// runtime.storage as an application's features receive it, from StorageProvider on JSKIT_STORAGE_DRIVER=s3 with
// these settings.
async function s3RuntimeStorage(t, settings) {
  let storage;
  const consumer = defineProvider({
    id: "test.storage.consumer",
    requires: { value: "runtime.storage" },
    setup({ value }) {
      storage = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.app-root": process.cwd(),
      "runtime.env": {
        JSKIT_STORAGE_DRIVER: "s3",
        JSKIT_STORAGE_S3_BUCKET: settings.bucket,
        JSKIT_STORAGE_S3_REGION: settings.region,
        JSKIT_STORAGE_S3_ENDPOINT: settings.endpoint,
        JSKIT_STORAGE_S3_ACCESS_KEY_ID: settings.accessKeyId,
        JSKIT_STORAGE_S3_SECRET_ACCESS_KEY: settings.secretAccessKey
      }
    },
    providers: [StorageProvider, consumer]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());
  return storage;
}

async function startBucket(t, credentials) {
  const bucket = await startS3StandIn(credentials);
  t.after(() => bucket.close());
  return bucket;
}

function avatarUpload() {
  return {
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
  };
}

test("saving a profile picture answers 200 with the account's plain settings", async (t) => {
  const { app, storedFiles } = await profileApp(t);

  const response = await app.inject(avatarUpload());

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

test("on JSKIT_STORAGE_DRIVER=s3 a profile picture is saved to, served from and removed from the bucket", async (t) => {
  const bucket = await startBucket(t, S3_BUCKET);
  const storage = await s3RuntimeStorage(t, { ...S3_BUCKET, endpoint: bucket.endpoint });
  const { app } = await profileApp(t, { storage });

  const uploaded = await app.inject(avatarUpload());
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  assert.equal(uploaded.json().profile.avatar.hasUploadedAvatar, true);
  assert.deepEqual([...bucket.objects.keys()], ["users/avatars/7/avatar"]);
  assert.deepEqual(bucket.objects.get("users/avatars/7/avatar"), PNG_BYTES);

  const served = await app.inject({ method: "GET", url: "/api/settings/profile/avatar" });
  assert.equal(served.statusCode, 200, served.body);
  assert.equal(served.headers["content-type"], "image/png");
  assert.deepEqual(served.rawPayload, PNG_BYTES);

  const removed = await app.inject({ method: "DELETE", url: "/api/settings/profile/avatar" });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(bucket.objects.size, 0);
  assert.equal((await app.inject({ method: "GET", url: "/api/settings/profile/avatar" })).statusCode, 404);
});

test("a bucket that refuses a profile picture logs S3's answer and never the storage secret", async (t) => {
  const bucket = await startBucket(t, { ...S3_BUCKET, secretAccessKey: "the-bucket-holds-another-secret" });
  const storage = await s3RuntimeStorage(t, { ...S3_BUCKET, endpoint: bucket.endpoint });
  const logLines = [];
  const { app } = await profileApp(t, { storage, logStream: { write: (line) => logLines.push(line) } });
  // An application that logs its storage at startup, as a diagnostic.
  app.log.info({ mounts: storage.getMounts() }, "storage mounts");

  const response = await app.inject(avatarUpload());

  assert.equal(response.statusCode, 500, response.body);
  assert.equal(bucket.objects.size, 0);
  const log = logLines.join("");
  assert.match(log, /storage mounts/u);
  assert.match(log, /SignatureDoesNotMatch/u);
  assert.equal(log.includes(S3_BUCKET.secretAccessKey), false);
  assert.equal(response.body.includes(S3_BUCKET.secretAccessKey), false);
});
