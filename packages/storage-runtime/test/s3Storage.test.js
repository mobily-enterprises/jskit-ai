import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { StorageProvider } from "../src/server/providers/StorageProvider.js";
import { startS3StandIn } from "./support/s3StandIn.js";

const BUCKET = Object.freeze({
  bucket: "jskit-files",
  region: "eu-west-1",
  accessKeyId: "AKIASTANDIN",
  secretAccessKey: `stand-in-secret-${randomUUID()}`
});
const REQUIRED_SETTINGS = Object.freeze([
  "JSKIT_STORAGE_S3_BUCKET",
  "JSKIT_STORAGE_S3_REGION",
  "JSKIT_STORAGE_S3_ACCESS_KEY_ID",
  "JSKIT_STORAGE_S3_SECRET_ACCESS_KEY"
]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function s3Env(endpoint, overrides = {}) {
  return {
    JSKIT_STORAGE_DRIVER: "s3",
    JSKIT_STORAGE_S3_BUCKET: BUCKET.bucket,
    JSKIT_STORAGE_S3_REGION: BUCKET.region,
    JSKIT_STORAGE_S3_ENDPOINT: endpoint,
    JSKIT_STORAGE_S3_ACCESS_KEY_ID: BUCKET.accessKeyId,
    JSKIT_STORAGE_S3_SECRET_ACCESS_KEY: BUCKET.secretAccessKey,
    ...overrides
  };
}

// runtime.storage as an application's features receive it: StorageProvider in a capability runtime over this env.
function storageRuntime(env) {
  const received = {};
  const consumer = defineProvider({
    id: "test.storage.consumer",
    requires: { storage: "runtime.storage" },
    setup({ storage }) {
      received.storage = storage;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.app-root": process.cwd(), "runtime.env": env },
    providers: [StorageProvider, consumer]
  });
  return { runtime, received };
}

async function startStorage(t, env) {
  const { runtime, received } = storageRuntime(env);
  await runtime.start();
  t.after(() => runtime.shutdown());
  return received.storage;
}

async function startBucket(t, credentials = BUCKET) {
  const standIn = await startS3StandIn(credentials);
  t.after(() => standIn.close());
  return standIn;
}

test("JSKIT_STORAGE_DRIVER=s3 puts, gets, lists and removes objects in the bucket with the configured credentials", async (t) => {
  const bucket = await startBucket(t);
  const storage = await startStorage(t, s3Env(bucket.endpoint));

  await storage.setItemRaw("users/avatars/7/avatar", PNG_BYTES);
  await storage.setItem("notes/today", "ships at noon");
  await storage.setItem("notes/plan", { stage: 4 });

  // Each object sits in the bucket under its key as a path, and every request was signed with the configured
  // credentials: the stand-in answers any other signature 403, as S3 does.
  assert.deepEqual([...bucket.objects.keys()].sort(), ["notes/plan", "notes/today", "users/avatars/7/avatar"]);
  assert.deepEqual(bucket.objects.get("users/avatars/7/avatar"), PNG_BYTES);
  assert.deepEqual(Buffer.from(await storage.getItemRaw("users/avatars/7/avatar")), PNG_BYTES);
  assert.equal(await storage.getItem("notes/today"), "ships at noon");
  assert.deepEqual(await storage.getItem("notes/plan"), { stage: 4 });
  assert.equal(await storage.getItem("notes/missing"), null);
  assert.equal(await storage.hasItem("notes/today"), true);
  assert.equal(await storage.hasItem("notes/missing"), false);
  assert.deepEqual((await storage.getKeys("notes")).sort(), ["notes:plan", "notes:today"]);

  await storage.removeItem("notes/today");
  assert.equal(bucket.objects.has("notes/today"), false);
  assert.equal(await storage.hasItem("notes/today"), false);
  assert.deepEqual(await storage.getKeys("notes"), ["notes:plan"]);
  assert.deepEqual((await storage.getKeys()).sort(), ["notes:plan", "users:avatars:7:avatar"]);
  assert.deepEqual(bucket.requests.filter((request) => request.status === 403 || request.status === 400), []);
});

test("a bucket that refuses the credentials fails the storage call with S3's own error", async (t) => {
  const bucket = await startBucket(t, { ...BUCKET, secretAccessKey: "the-bucket-holds-another-secret" });
  const storage = await startStorage(t, s3Env(bucket.endpoint));

  await assert.rejects(storage.setItemRaw("users/avatars/7/avatar", PNG_BYTES), (error) => {
    assert.match(error.message, /403 Forbidden .*SignatureDoesNotMatch/su);
    assert.equal(error.message.includes(BUCKET.secretAccessKey), false);
    return true;
  });
  assert.equal(bucket.objects.size, 0);
});

test("a missing required S3 setting refuses at startup, naming the setting and no value", async (t) => {
  const bucket = await startBucket(t);

  for (const setting of REQUIRED_SETTINGS) {
    const { runtime } = storageRuntime(s3Env(bucket.endpoint, { [setting]: " " }));
    await assert.rejects(runtime.start(), (error) => {
      assert.equal(error.message, `JSKIT_STORAGE_DRIVER=s3 needs ${setting}, which is not set.`);
      return true;
    });
  }

  const { runtime } = storageRuntime({ JSKIT_STORAGE_DRIVER: "s3", JSKIT_STORAGE_S3_SECRET_ACCESS_KEY: BUCKET.secretAccessKey });
  await assert.rejects(runtime.start(), (error) => {
    assert.equal(
      error.message,
      "JSKIT_STORAGE_DRIVER=s3 needs JSKIT_STORAGE_S3_BUCKET, JSKIT_STORAGE_S3_REGION, JSKIT_STORAGE_S3_ACCESS_KEY_ID, " +
        "which are not set."
    );
    assert.equal(error.message.includes(BUCKET.secretAccessKey), false);
    return true;
  });
  assert.deepEqual(bucket.requests, []);
});

test("without JSKIT_STORAGE_S3_ENDPOINT the bucket is AWS's own in the region, and the mount shows no secret", async (t) => {
  const storage = await startStorage(t, s3Env(""));
  const { driver } = storage.getMount("");

  assert.equal(driver.name, "s3");
  assert.equal(driver.options.endpoint, "https://s3.eu-west-1.amazonaws.com");
  assert.equal(driver.options.bucket, BUCKET.bucket);
  assert.equal(driver.options.region, BUCKET.region);
  assert.equal(driver.options.accessKeyId, BUCKET.accessKeyId);
  assert.equal(driver.options.secretAccessKey, "[redacted]");
  assert.equal(JSON.stringify(storage.getMounts()).includes(BUCKET.secretAccessKey), false);
});
