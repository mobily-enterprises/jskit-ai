import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_TEXTS, authMessageFields, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { validateEmailInput, validatePasswordInput } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url, verifySignedToken } from "./tokens.js";

const RECOVERY_SESSION_TTL_SECONDS = 15 * 60;
const RECOVERY_TOKEN_TTL_SECONDS = 60 * 60;
// A password reset's recovery tokens have ids starting `rec_`, which tells them from an app's own kinds (such as a
// sign-in link's): completing a reset consumes the user's other resets and leaves the other kinds open.
const RESET_TOKEN_KIND = "rec";

/**
 * The `auth.local.recovery-sender` default when no feature provides one: outside
 * production, local auth logs each recovery link instead of emailing it.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").AuthLocalRecoverySender}
 */
function createLoggedRecoverySender(logger) {
  return async function logRecoveryLink({ email, recoveryUrl }) {
    logger.info({ recoveryUrl, email }, "Local auth password recovery URL created.");
  };
}

/**
 * Changing a password, and recovering one: a recovery link opens a short
 * recovery session, which can only set a new password.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalPasswords} dependencies.passwords
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalRecoverySender} dependencies.recoverySender Sends each recovery
 *   link, except when the configuration returns it in the response.
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalPasswordFlows({ backend, config, passwords, profileProjector, recoverySender, sessions }) {
  const { recoveryEnabled } = config;
  const recoveryInResponse = config.recoveryDelivery === "dev-response";

  async function requestPasswordReset(input) {
    if (!recoveryEnabled) {
      throw new AppError(503, "Password recovery is not configured.", { code: "auth.local.recovery.notConfigured" });
    }
    const email = validateEmailInput(input.email);
    let recoveryUrl = "";
    await backend.withTransaction(async (tx) => {
      const user = await tx.users.findByEmail(email);
      if (!user || user.disabled) {
        return;
      }
      const token = randomToken(32);
      recoveryUrl = `${config.appPublicUrl.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}&type=recovery`;
      await tx.recovery.create({
        id: createId(RESET_TOKEN_KIND),
        userId: user.id,
        tokenHash: sha256Base64url(token),
        expiresAt: isoFromNow(RECOVERY_TOKEN_TTL_SECONDS)
      });
    });
    if (recoveryUrl && !recoveryInResponse) {
      await recoverySender({ email, recoveryUrl });
    }
    return {
      ok: true,
      message: "If an account exists for that email, password reset instructions have been sent.",
      messageCode: "auth.local.recovery.requested",
      messageParams: {},
      ...(recoveryUrl && recoveryInResponse ? { recoveryUrl } : {})
    };
  }

  async function completePasswordRecovery(input) {
    if (!recoveryEnabled) {
      throw new AppError(503, "Password recovery is not configured.", { code: "auth.local.recovery.notConfigured" });
    }
    // Only the emailed token itself: the hash this provider stores of it never opens an account.
    const token = String(input.code || input.token || "").trim();
    if (!token) {
      throw createAuthError(AUTH_TEXTS.recoveryTokenRequired);
    }
    const tokenInvalid = () => new AppError(401, "Recovery token is invalid or expired.", { code: "auth.local.recovery.tokenInvalid" });
    return backend.withTransaction(async (tx) => {
      const recovery = await tx.recovery.findByTokenHash(sha256Base64url(token));
      if (!recovery || recovery.usedAt || isExpiredIso(recovery.expiresAt)) {
        throw tokenInvalid();
      }
      // Of two completions with one token at once, only the one that consumes it opens a session.
      if (!await tx.recovery.consume(recovery.id)) {
        throw tokenInvalid();
      }
      const user = await tx.users.findById(recovery.userId);
      if (!user || user.disabled) {
        throw tokenInvalid();
      }
      const session = await sessions.createSessionForUser(tx, user, {
        purpose: "recovery",
        ttlSeconds: RECOVERY_SESSION_TTL_SECONDS
      });
      return buildAuthPayload({ user, session, profileProjector });
    });
  }

  async function resetPassword(input, request) {
    validatePasswordInput(input.password, config.passwordMinLength);
    const payload = verifySignedToken(sessions.readRecoveryAccessToken(request), config.sessionSecret);
    if (!payload?.sub || !payload?.sid) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    const password = await passwords.hashPassword(input.password);
    await backend.withTransaction(async (tx) => {
      const session = await tx.sessions.findById(String(payload.sid));
      if (!session || session.revokedAt || isExpiredIso(session.expiresAt)) {
        throw createAuthError(AUTH_TEXTS.sessionRequired);
      }
      if (session.purpose !== "recovery") {
        throw new AppError(401, "Recovery session required.", { code: "auth.local.recovery.sessionRequired" });
      }
      const user = await tx.users.updatePassword(String(payload.sub), password);
      await tx.sessions.revokeForUser(String(payload.sub));
      await tx.recovery.consumeForUser(String(payload.sub), { idPrefix: `${RESET_TOKEN_KIND}_` });
      // Recovery is the way back in for an account that failed sign-ins keep waiting.
      if (user) {
        await tx.signInFailures.clear(user.email);
      }
    });
    sessions.forgetRequestAuthentication(request);
    return {
      ok: true,
      ...authMessageFields(AUTH_TEXTS.passwordUpdatedSignIn)
    };
  }

  async function changePassword(request, input) {
    validatePasswordInput(input.newPassword, config.passwordMinLength);
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true || authResult.sessionPurpose !== "normal") {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }

    const currentPassword = String(input.currentPassword || "");
    const password = await passwords.hashPassword(input.newPassword);
    await backend.withTransaction(async (tx) => {
      const user = await tx.users.findById(authResult.actor.providerUserId);
      if (!user || user.disabled) {
        throw createAuthError(AUTH_TEXTS.sessionRequired);
      }
      if (!(await passwords.verifyPassword(currentPassword, user.password))) {
        throw new AppError(401, "Current password is invalid.", { code: "auth.local.password.currentInvalid" });
      }
      await tx.users.updatePassword(user.id, password);
    });

    return {
      ok: true,
      message: "Password updated.",
      messageCode: "auth.local.password.changed",
      messageParams: {}
    };
  }

  return Object.freeze({
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    changePassword
  });
}

export { createLocalPasswordFlows, createLoggedRecoverySender };
