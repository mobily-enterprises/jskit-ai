import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { hostOnlyCookieName } from "@jskit-ai/auth-core/server/utils";
import { AUTH_TEXTS, authMessageFields, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { validateEmailInput, validatePasswordInput } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { RECOVERY_TOKEN_COOKIE_NAME, safeRequestCookies } from "./sessions.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url, verifySignedToken } from "./tokens.js";

const RECOVERY_SESSION_TTL_SECONDS = 15 * 60;
const RECOVERY_TOKEN_TTL_SECONDS = 60 * 60;

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} AuthProfileProjector */

// Changing a password, and recovering one: a recovery link opens a short
// recovery session, which can only set a new password.
/**
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {ReturnType<typeof import("../providers/AuthLocalProvider.js").resolveConfig>} dependencies.config
 * @param {boolean} dependencies.isProduction
 * @param {ReturnType<typeof import("./passwords.js").normalizePasswordStrategy>} dependencies.passwords
 * @param {AuthProfileProjector | null} dependencies.profileProjector
 * @param {boolean} dependencies.recoveryEnabled
 * @param {((delivery: { email: string, recoveryUrl: string }) => Promise<void>) | null} dependencies.recoverySender The `auth.local.recovery-sender`, when one is installed.
 * @param {ReturnType<typeof import("./sessions.js").createLocalSessions>} dependencies.sessions
 */
function createLocalPasswordFlows({
  backend,
  config,
  isProduction,
  passwords,
  profileProjector,
  recoveryEnabled,
  recoverySender,
  sessions
}) {
  const RECOVERY_TOKEN_COOKIE = hostOnlyCookieName(RECOVERY_TOKEN_COOKIE_NAME, isProduction);

  async function requestPasswordReset(input = {}) {
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
        id: createId("rec"),
        userId: user.id,
        tokenHash: sha256Base64url(token),
        expiresAt: isoFromNow(RECOVERY_TOKEN_TTL_SECONDS)
      });
    });
    if (recoveryUrl) {
      if (recoverySender) await recoverySender({ email, recoveryUrl });
      if (!recoverySender && config.recoveryDevOutput === "log" && config.logger?.info) {
        config.logger.info({ recoveryUrl, email }, "Local auth password recovery URL created.");
      }
    }
    return {
      ok: true,
      message: "If an account exists for that email, password reset instructions have been sent.",
      messageCode: "auth.local.recovery.requested",
      messageParams: {},
      ...(recoveryUrl && !recoverySender && config.recoveryDevOutput === "response" ? { recoveryUrl } : {})
    };
  }

  async function completePasswordRecovery(input = {}) {
    if (!recoveryEnabled) {
      throw new AppError(503, "Password recovery is not configured.", { code: "auth.local.recovery.notConfigured" });
    }
    const token = String(input.code || input.token || "").trim();
    const tokenHash = String(input.tokenHash || "").trim() || (token ? sha256Base64url(token) : "");
    if (!tokenHash) {
      throw createAuthError(AUTH_TEXTS.recoveryTokenRequired);
    }
    return backend.withTransaction(async (tx) => {
      const recovery = await tx.recovery.findByTokenHash(tokenHash);
      if (!recovery || recovery.usedAt || isExpiredIso(recovery.expiresAt)) {
        throw new AppError(401, "Recovery token is invalid or expired.", { code: "auth.local.recovery.tokenInvalid" });
      }
      await tx.recovery.consume(recovery.id);
      const user = await tx.users.findById(recovery.userId);
      if (!user || user.disabled) {
        throw new AppError(401, "Recovery token is invalid or expired.", { code: "auth.local.recovery.tokenInvalid" });
      }
      const session = await sessions.createSessionForUser(tx, user, {
        purpose: "recovery",
        ttlSeconds: RECOVERY_SESSION_TTL_SECONDS
      });
      return buildAuthPayload({ user, session, profileProjector });
    });
  }

  async function resetPassword(request, input = {}) {
    validatePasswordInput(input.password);
    const cookies = safeRequestCookies(request);
    const recoveryAccessToken = String(cookies[RECOVERY_TOKEN_COOKIE] || "").trim();
    const payload = verifySignedToken(recoveryAccessToken, config.sessionSecret);
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
      await tx.users.updatePassword(String(payload.sub), password);
      await tx.sessions.revokeForUser(String(payload.sub));
      await tx.recovery.consumeForUser(String(payload.sub));
    });
    return {
      ok: true,
      ...authMessageFields(AUTH_TEXTS.passwordUpdatedSignIn)
    };
  }

  async function changePassword(request, input = {}) {
    validatePasswordInput(input.newPassword);
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

export { createLocalPasswordFlows };
