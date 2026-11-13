import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signPass } from "@jskit-ai/auth-core/server/passSignIn";
import { NO_PASSWORD } from "../src/server/lib/accounts.js";

/**
 * A pass issuer of the test's own: the env that makes local auth trust its key, for the application "editor" on the
 * resource "machine-7", and the passes it signs.
 */
function createPassIssuer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return Object.freeze({
    privateKey,
    env: Object.freeze({
      AUTH_PASS_PUBLIC_KEY: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      AUTH_PASS_AUDIENCE: "editor",
      AUTH_PASS_RESOURCE: "machine-7"
    }),
    /**
     * @param {string} subject
     * @param {Partial<Parameters<typeof signPass>[0]>} [overrides]
     */
    pass(subject, overrides = {}) {
      return signPass({ privateKey, subject, audience: "editor", resource: "machine-7", ...overrides });
    }
  });
}

/**
 * The application's mapping in these tests: a pass's subject is the email of the account it signs in, and the
 * subject "ghost" names an account id that does not exist.
 * @param {import("../src/server/types.js").AuthLocalBackend} backend
 * @returns {import("../src/server/types.js").AuthLocalPassIdentity}
 */
function passIdentityByEmail(backend) {
  return async (pass) => {
    if (pass.subject === "ghost") {
      return "usr_missing";
    }
    const user = await backend.withTransaction((tx) => tx.users.findByEmail(pass.subject));
    return user ? user.id : null;
  };
}

/**
 * An account a pass signs in, as an application whose people sign in only with passes makes it: without a password.
 * @param {{ id: string, email: string, displayName: string, disabled?: boolean }} account
 */
function passwordlessAccount({ id, email, displayName, disabled = false }) {
  return { id, email, displayName, password: NO_PASSWORD, disabled };
}

function sessionCookies(session) {
  return { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
}

const refused = (code, status = 401) => ({ status, code });

/**
 * Pass sign-in against any backend, for a service given the issuer's env and passIdentityByEmail: a pass signs its
 * person in once, without a password, and every other pass is refused with its reason.
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} service
 * @param {object} fixtures
 * @param {import("../src/server/types.js").AuthLocalBackend} fixtures.backend
 * @param {ReturnType<typeof createPassIssuer>} fixtures.issuer
 */
async function exercisePassSignIn(service, { backend, issuer }) {
  await backend.withTransaction(async (tx) => {
    await tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" }));
    await tx.users.create(passwordlessAccount({ id: "usr_off", email: "off@example.com", displayName: "Off", disabled: true }));
  });

  // A pass signs its person in, with an ordinary session, though the account has no password.
  const pass = issuer.pass("ada@example.com");
  const signedIn = await service.signInWithPass({ pass });
  assert.equal(signedIn.actor.id, "usr_ada");
  assert.equal(signedIn.actor.email, "ada@example.com");
  const authenticated = await service.authenticateRequest({ cookies: sessionCookies(signedIn.session) });
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.actor.id, "usr_ada");

  // Only once.
  await assert.rejects(service.signInWithPass({ pass }), refused("auth.pass.replayed"));
  // Another pass for the same person signs in again.
  assert.equal((await service.signInWithPass({ pass: issuer.pass("ada@example.com") })).actor.id, "usr_ada");

  // A pass whose subject has no account, names an account that does not exist, or names a disabled one.
  for (const subject of ["nobody@example.com", "ghost", "off@example.com"]) {
    await assert.rejects(service.signInWithPass({ pass: issuer.pass(subject) }), refused("auth.pass.unmapped", 403));
  }
  // An unmapped pass was used all the same: it is refused as replayed, even once its subject has an account.
  const early = issuer.pass("late@example.com");
  await assert.rejects(service.signInWithPass({ pass: early }), refused("auth.pass.unmapped", 403));
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_late", email: "late@example.com", displayName: "Late" })));
  await assert.rejects(service.signInWithPass({ pass: early }), refused("auth.pass.replayed"));

  // A pass for another application or resource, signed by another key, expired, or not a pass at all.
  const stranger = generateKeyPairSync("ed25519");
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("ada@example.com", { audience: "console" }) }),
    refused("auth.pass.wrongAudience"));
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("ada@example.com", { resource: "machine-8" }) }),
    refused("auth.pass.wrongResource"));
  await assert.rejects(service.signInWithPass({ pass: signPass({
    privateKey: stranger.privateKey, subject: "ada@example.com", audience: "editor", resource: "machine-7"
  }) }), refused("auth.pass.badSignature"));
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("ada@example.com", { now: Date.now() - 91_000 }) }),
    refused("auth.pass.expired"));
  await assert.rejects(service.signInWithPass({ pass: "not a pass" }), refused("auth.pass.malformed"));
}

export { createPassIssuer, exercisePassSignIn, passIdentityByEmail, passwordlessAccount, sessionCookies };
