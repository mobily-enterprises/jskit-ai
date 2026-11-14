import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { exerciseSessionMetadata } from "../test-support/sessionMetadataScenario.js";

test("a session keeps where and when it was last seen, at most every five minutes (file backend)", async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-session-metadata-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  await exerciseSessionMetadata(t, { service: createLocalAuthService({ ...localServiceOptions(), backend }), backend });
});

test("a session the file backend stored before it kept where sessions are seen reads as never seen", async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-session-metadata-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const field = (value) => Buffer.from(value, "utf8").toString("base64url");
  const line = ["session", "v1", "ses_old", "usr_old", "hash-old", "normal",
    field("2026-11-01T09:00:00.000Z"), field("2026-12-01T09:00:00.000Z"), field(""), field("")].join(":");
  await fs.writeFile(path.join(storeDir, "sessions.passwd"), `${line}\n`);
  const backend = createLocalFileBackend({ storeDir });
  assert.deepEqual(await backend.withTransaction((tx) => tx.sessions.findById("ses_old")), {
    id: "ses_old",
    userId: "usr_old",
    tokenHash: "hash-old",
    purpose: "normal",
    createdAt: "2026-11-01T09:00:00.000Z",
    expiresAt: "2026-12-01T09:00:00.000Z",
    revokedAt: "",
    secondFactorAt: "",
    ip: "",
    userAgent: "",
    lastSeenAt: ""
  });
});
