import { PASS_TEXTS, createPassError, verifyPass } from "@jskit-ai/auth-pass/server";
import { accountDisabledError } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { sha256Base64url } from "./tokens.js";

/**
 * The pass identity of a local auth service given none: it names no account, so every pass is refused as unmapped.
 * The provider instead stops startup when AUTH_PASS_PUBLIC_KEY is set and no `auth.local.pass-identity` is installed.
 * @type {import("../types.js").AuthLocalPassIdentity}
 */
async function noPassIdentities() {
  return null;
}

/**
 * Sign-in with a one-time signed pass (`@jskit-ai/auth-pass/server`), for a configuration whose passSignIn
 * holds the issuer's key, audience and resource. A pass is checked, then recorded as used in the backend, so it signs
 * in once however many servers share the backend's database, and then the application's pass identity names the
 * account it signs in: one that is missing is refused as unmapped, and a disabled one is told it is disabled, as its
 * right password is. The session is an ordinary one, as a password sign-in makes.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalPassIdentity} dependencies.passIdentity The `auth.local.pass-identity`, or
 *   noPassIdentities.
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalPassSignIn({ backend, config, passIdentity, profileProjector, sessions }) {
  const settings = config.passSignIn;

  /** @param {{ pass: string }} input */
  async function signInWithPass(input) {
    const pass = verifyPass(input.pass, settings);
    // Kept by the hash of its id, which the issuer chose, until the pass could no longer be used anyway. The expired
    // ones go in a transaction of their own: in the same one, the range their delete locks would make two concurrent
    // uses wait on each other's insert.
    await backend.withTransaction((tx) => tx.passes.deleteExpired(new Date().toISOString()));
    const firstUse = await backend.withTransaction((tx) =>
      tx.passes.use({ id: sha256Base64url(pass.id), expiresAt: pass.usableUntil }));
    if (!firstUse) {
      throw createPassError(PASS_TEXTS.passReplayed);
    }
    const userId = await passIdentity(pass);
    const user = userId ? await backend.withTransaction((tx) => tx.users.findById(userId)) : null;
    if (!user) {
      throw createPassError(PASS_TEXTS.passUnmapped);
    }
    if (user.disabled) {
      throw accountDisabledError(user);
    }
    const session = await backend.withTransaction((tx) => sessions.createSessionForUser(tx, user));
    // After the transaction, as a password sign-in does: the profile projector works in transactions of its own.
    return buildAuthPayload({ user, session, profileProjector });
  }

  return Object.freeze({
    signInWithPass
  });
}

export { createLocalPassSignIn, noPassIdentities };
