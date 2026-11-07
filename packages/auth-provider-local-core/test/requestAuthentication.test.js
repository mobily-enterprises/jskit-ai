import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";

// A file backend that counts session reads (each authentication reads its session once) and can fail the next one.
async function startService(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-request-auth-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const files = createLocalFileBackend({ storeDir });
  const reads = { sessions: 0, failNext: false };
  function readSession(tx, method, args) {
    reads.sessions += 1;
    if (reads.failNext) {
      reads.failNext = false;
      throw new Error("The session store is unavailable.");
    }
    return tx.sessions[method](...args);
  }
  const backend = {
    ...files,
    withTransaction: (work) => files.withTransaction((tx) => work({
      ...tx,
      sessions: Object.create(tx.sessions, {
        findById: { value: (...args) => readSession(tx, "findById", args) },
        findByTokenHash: { value: (...args) => readSession(tx, "findByTokenHash", args) }
      })
    }))
  };
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  await service.register({ email: "ada@example.com", password: "correct horse" });
  return { service, reads };
}

async function signIn(service) {
  return sessionCookies((await service.login({ email: "ada@example.com", password: "correct horse" })).session);
}

test("a request authenticates once however many of its handlers ask, and answers its own display name change", async (t) => {
  const { service, reads } = await startService(t);
  const cookies = await signIn(service);

  // GET /api/settings: the route's auth policy, then the security status.
  const settings = { cookies };
  reads.sessions = 0;
  assert.equal((await service.authenticateRequest(settings)).authenticated, true);
  assert.equal((await service.getSecurityStatus(settings)).actions.signOutOtherSessions, true);
  assert.equal(reads.sessions, 1);

  // PATCH /api/settings/profile: the route's auth policy, the display name change, then the security status.
  const patch = { cookies };
  reads.sessions = 0;
  assert.equal((await service.authenticateRequest(patch)).actor.displayName, "ada");
  await service.updateDisplayName(patch, { displayName: "Ada Lovelace" });
  await service.getSecurityStatus(patch);
  assert.equal((await service.authenticateRequest(patch)).actor.displayName, "Ada Lovelace");
  assert.equal(reads.sessions, 1);

  // Each new request reads its session again.
  assert.equal((await service.authenticateRequest({ cookies })).actor.displayName, "Ada Lovelace");
  assert.equal(reads.sessions, 2);
});

test("revocation applies from the next request, and within the request that signs itself out", async (t) => {
  const { service } = await startService(t);
  const laptop = await signIn(service);
  const phone = await signIn(service);

  // The phone signs out the laptop (and the session registering opened): the laptop's next request is signed out,
  // the phone's are not.
  const phoneRequest = { cookies: phone };
  assert.equal((await service.authenticateRequest(phoneRequest)).authenticated, true);
  assert.equal((await service.signOutOtherSessions(phoneRequest)).revokedSessions, 2);
  assert.equal((await service.authenticateRequest(phoneRequest)).authenticated, true);
  assert.equal((await service.authenticateRequest({ cookies: laptop })).authenticated, false);

  // A request that signs out answers signed out from then on.
  const signOut = { cookies: phone };
  assert.equal((await service.authenticateRequest(signOut)).authenticated, true);
  await service.logout(signOut);
  assert.equal((await service.authenticateRequest(signOut)).authenticated, false);
  assert.equal((await service.authenticateRequest({ cookies: phone })).authenticated, false);
});

test("a failed authentication is not remembered for the rest of its request", async (t) => {
  const { service, reads } = await startService(t);
  const request = { cookies: await signIn(service) };
  reads.failNext = true;
  await assert.rejects(service.authenticateRequest(request), /session store is unavailable/u);
  assert.equal((await service.authenticateRequest(request)).authenticated, true);
});
