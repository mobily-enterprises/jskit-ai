import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalFileBackend } from "../src/server/lib/index.js";
import { emailChangeService, exerciseEmailChange } from "../test-support/emailChangeScenario.js";

async function fileBackend(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-email-change-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return { backend: createLocalFileBackend({ storeDir }), storeDir };
}

test("an account's email changes once the link sent to the new address is used, and the old address is told (file backend)", async (t) => {
  const { backend, storeDir } = await fileBackend(t);
  const { adaId } = await exerciseEmailChange(t, backend);
  // Another server on the same store reads the change.
  const reread = createLocalFileBackend({ storeDir });
  assert.equal((await reread.withTransaction((tx) => tx.users.findById(adaId))).email, "ada.second@example.com");
});

test("a waiting change is kept in the file store, and an account stored before it read as having none", async (t) => {
  const { backend, storeDir } = await fileBackend(t);
  const { service } = emailChangeService(backend);
  const ada = await service.register({ email: "ada@example.com", password: "correct horse battery staple" });
  await service.requestEmailChangeForUser({ userId: ada.actor.providerUserId, email: "ada.new@example.com" });
  const reread = createLocalFileBackend({ storeDir });
  assert.equal((await reread.withTransaction((tx) => tx.users.findById(ada.actor.providerUserId))).pendingEmail, "ada.new@example.com");

  const usersFile = path.join(storeDir, "users.passwd");
  const line = (await fs.readFile(usersFile, "utf8")).trim();
  // The twelve fields an account had before it kept a waiting change.
  await fs.writeFile(usersFile, `${line.split(":").slice(0, 12).join(":")}\n`);
  const older = createLocalFileBackend({ storeDir });
  assert.equal((await older.withTransaction((tx) => tx.users.findById(ada.actor.providerUserId))).pendingEmail, "");
});
