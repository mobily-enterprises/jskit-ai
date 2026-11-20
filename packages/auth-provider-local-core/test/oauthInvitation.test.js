import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createLocalFileBackend } from "../src/server/lib/index.js";
import { parseOAuthAttempts, serializeOAuthAttempts } from "../src/server/lib/fileRecords.js";
import { approveAtProvider, createService, oidcProviderEntry, startOidcProvider } from "../test-support/oauthHarness.js";

/**
 * A Google sign-in over the file backend whose invitation context resolver answers `resolve(input)`, and whose
 * profile sync records what each sign-in tells it.
 */
async function invitationSetup(t, resolve) {
  const issuer = await startOidcProvider();
  t.after(() => issuer.close());
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-oauth-invite-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const synced = [];
  const resolved = [];
  const warnings = [];
  const service = createService({
    backend: createLocalFileBackend({ storeDir }),
    oauthProviders: [oidcProviderEntry(issuer)],
    profileProjector: {
      async syncIdentityProfile(profile, options) {
        synced.push({ email: profile.email, options });
        return null;
      },
      async findByIdentity() {
        return null;
      }
    },
    invitationContextResolver: {
      async resolveInvitationContext(input) {
        resolved.push(input);
        return resolve(input);
      }
    },
    logger: { ...silentLogger, warn: (_details, message) => warnings.push(message) }
  });
  const signIn = async (invitationToken) => {
    const { input, request } = await approveAtProvider(service, { invitationToken });
    return service.oauthComplete(input, request);
  };
  return { issuer, storeDir, service, synced, resolved, warnings, signIn };
}

test("a provider sign-in started from an invitation keeps it to the end and gives profile sync the resolved invitation", async (t) => {
  const invitation = { token: "invite-token", source: "workspace-invite", workspaceId: "3", email: "invited@example.com" };
  const { issuer, storeDir, service, synced, resolved } = await invitationSetup(t, ({ token }) => ({ ...invitation, token }));

  const { input, request } = await approveAtProvider(service, { invitationToken: " invite-token " });
  const attempts = parseOAuthAttempts(await fs.readFile(path.join(storeDir, "oauth-attempts.passwd"), "utf8"));
  assert.equal(attempts[0].invitationToken, "invite-token", "the attempt keeps the invitation across the provider's round trip");
  const result = await service.oauthComplete(input, request);

  assert.equal(result.actor.email, issuer.account.email);
  assert.equal(result.returnTo, "/home");
  assert.deepEqual(resolved, [{ token: "invite-token", email: issuer.account.email }]);
  assert.deepEqual(synced, [{ email: issuer.account.email, options: { source: "workspace-invite", invitation } }]);

  // A sign-in from no invitation asks the resolver nothing and tells profile sync nothing.
  const { input: again, request: againRequest } = await approveAtProvider(service);
  await service.oauthComplete(again, againRequest);
  assert.equal(resolved.length, 1);
  assert.deepEqual(synced[1], { email: issuer.account.email, options: {} });
});

test("an invitation the app refuses, or cannot read, never fails a provider sign-in, which goes on without it", async (t) => {
  const { issuer, synced, warnings, signIn } = await invitationSetup(t, ({ token }) => {
    if (token === "expired") {
      throw new AppError(409, "This invitation has expired.", { code: "workspaces.invite.expired" });
    }
    throw new Error("The invitations store is unavailable.");
  });

  for (const token of ["expired", "unreadable"]) {
    const result = await signIn(token);
    assert.equal(result.actor.email, issuer.account.email, token);
    assert.equal(result.session.purpose, "normal", token);
  }

  assert.deepEqual(synced.map(({ options }) => options), [{}, {}], "profile sync provisions as for no invitation");
  assert.deepEqual(warnings, ["The invitation a provider sign-in started from could not be read; it signs in without it."],
    "only the failure that is not a refusal is logged");
});

test("an OAuth attempt record written before attempts kept an invitation still reads, as one without", () => {
  const attempt = {
    browserKeyHash: "hash",
    provider: "google",
    intent: "login",
    userId: "",
    state: "state",
    nonce: "nonce",
    codeVerifier: "verifier",
    returnTo: "/invite?token=a:b",
    createdAt: "2026-11-20T10:00:00.000Z",
    expiresAt: "2026-11-20T10:10:00.000Z",
    invitationToken: "token:with:colons"
  };
  const line = serializeOAuthAttempts([attempt]);
  assert.deepEqual(parseOAuthAttempts(line), [attempt]);

  const twelveFields = `${line.trimEnd().split(":").slice(0, 12).join(":")}\n`;
  assert.deepEqual(parseOAuthAttempts(twelveFields), [{ ...attempt, invitationToken: "" }]);
  assert.throws(() => parseOAuthAttempts(`${line.trimEnd()}:extra\n`), /Invalid OAuth attempt record field count\./u);
});
