import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  buildOtpauthUrl,
  deriveSecondFactorKeys,
  findRecoveryCodeHash,
  hashRecoveryCode,
  matchCodeStep,
  newAuthenticatorSecret,
  newRecoveryCode,
  normalizeAuthenticatorCode,
  normalizeRecoveryCode,
  openSecret,
  sealSecret
} from "./secondFactorCrypto.js";
import { nextFailures, signInWaitMs, waitParams } from "./signInThrottle.js";

const RECOVERY_CODE_COUNT = 10;

// The refusals of the second factor's operations. A wrong code, a used code and a wrong recovery code count as failed
// attempts, which make the account wait as failed sign-ins do.
const REFUSALS = Object.freeze({
  notSetUp: Object.freeze({ status: 409, code: "auth.local.secondFactor.notSetUp", message: "No authenticator is set up for this account." }),
  alreadySetUp: Object.freeze({
    status: 409,
    code: "auth.local.secondFactor.alreadySetUp",
    message: "An authenticator is already set up for this account. Remove it before setting up another."
  }),
  setupNotStarted: Object.freeze({
    status: 409,
    code: "auth.local.secondFactor.setupNotStarted",
    message: "Start setting up the authenticator again."
  }),
  proofRequired: Object.freeze({
    status: 400,
    code: "auth.local.secondFactor.proofRequired",
    message: "Enter a code from your authenticator app or one of your recovery codes."
  }),
  codeInvalid: Object.freeze({
    status: 400,
    code: "auth.local.secondFactor.codeInvalid",
    message: "That code is not right. Enter the code your authenticator app shows now.",
    reason: "codeInvalid"
  }),
  codeUsed: Object.freeze({
    status: 400,
    code: "auth.local.secondFactor.codeUsed",
    message: "That code was already used. Wait for the next code from your authenticator app.",
    reason: "codeUsed"
  }),
  recoveryCodeInvalid: Object.freeze({
    status: 400,
    code: "auth.local.secondFactor.recoveryCodeInvalid",
    message: "That recovery code is not right, or it was already used.",
    reason: "recoveryCodeInvalid"
  })
});

/** @param {{ status: number, code: string, message: string }} refusal */
function secondFactorError(refusal) {
  return new AppError(refusal.status, refusal.message, { code: refusal.code });
}

/**
 * The refusal of a code while the account waits after wrong ones, with the
 * minutes to wait; Retry-After gives the exact seconds.
 * @param {number} waitMs
 */
function secondFactorLockedError(waitMs) {
  const params = waitParams(waitMs);
  const unit = params.count === 1 ? "minute" : "minutes";
  return new AppError(429, `Too many wrong codes. Try again in ${params.count} ${unit}.`, {
    code: "auth.local.secondFactor.locked",
    params,
    headers: { "retry-after": String(params.retryAfterSeconds) }
  });
}

/**
 * A proof as the person gave it: exactly one of a code and a recovery code.
 * @param {import("@jskit-ai/auth-core/server/types").AuthSecondFactorProof} input
 */
function readProof(input) {
  const code = String(input.code ?? "").trim();
  const recoveryCode = String(input.recoveryCode ?? "").trim();
  if (Boolean(code) === Boolean(recoveryCode)) {
    throw secondFactorError(REFUSALS.proofRequired);
  }
  return code ? { code } : { recoveryCode };
}

/** The factor's fields once an attempt succeeded: its failures forgotten. */
const NO_FAILURES = Object.freeze({ failures: 0, lastFailedAt: "", lockedUntil: "" });

/**
 * The `auth.local.second-factor-events` default when no feature provides one:
 * local auth logs each second factor event.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").AuthLocalSecondFactorEvents}
 */
function createLoggedSecondFactorEvents(logger) {
  return async function logSecondFactorEvent(event) {
    logger.info({ secondFactorEvent: event }, `Local auth second factor: ${event.type}.`);
  };
}

/**
 * Second factors of local auth: an authenticator app's codes (TOTP) with
 * recovery codes, one factor per account. Its secret is kept sealed with the
 * application's AUTH_LOCAL_SECOND_FACTOR_KEY and its recovery codes as keyed
 * hashes. An accepted code marks the request's session with the time, which
 * routes and actions that ask for a second factor compare; a code is accepted
 * once. Every change and every failed attempt is an event for the
 * application's `auth.local.second-factor-events`.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("../types.js").AuthLocalSecondFactorEvents} dependencies.secondFactorEvents
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalSecondFactor({ backend, config, logger, secondFactorEvents, sessions }) {
  const keys = deriveSecondFactorKeys(config.secondFactorKey);
  const issuer = new URL(config.appPublicUrl).host;

  /** The request's signed-in session, whose second factor the operation works with. */
  async function signedInSession(request) {
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    return {
      userId: authResult.actor.providerUserId,
      email: authResult.actor.email,
      sessionId: authResult.sessionId,
      secondFactorAt: authResult.secondFactorAt,
      ip: String(request.ip || "")
    };
  }

  /**
   * Hands one event to the application; a recorder that fails is logged and changes nothing that happened.
   * @param {import("../types.js").AuthLocalSecondFactorEvent["type"]} type
   * @param {{ userId: string, ip: string }} subject
   * @param {object} [details]
   */
  async function recordEvent(type, { userId, ip }, details = {}) {
    try {
      await secondFactorEvents({ type, userId, ip, at: new Date().toISOString(), ...details });
    } catch (error) {
      logger.warn({ err: error, secondFactorEvent: type, userId }, "Recording a local auth second factor event failed.");
    }
  }

  /**
   * Checks a code against the factor: the step of the code it accepts, or the refusal.
   * @param {string} userId
   * @param {object} factor
   * @param {string} typed
   * @param {number} now
   */
  function checkCode(userId, factor, typed, now) {
    const code = normalizeAuthenticatorCode(typed);
    const step = code ? matchCodeStep(openSecret(keys, userId, factor.secretSealed), code, now) : null;
    if (step === null) {
      return { refusal: REFUSALS.codeInvalid };
    }
    // A code is accepted once: one from the step of an accepted code, or an earlier one, is refused.
    if (step <= factor.lastUsedStep) {
      return { refusal: REFUSALS.codeUsed };
    }
    return { method: "code", changes: { lastUsedStep: step } };
  }

  /**
   * Checks a recovery code against the factor's: the codes left once it is used, or the refusal.
   * @param {string} userId
   * @param {object} factor
   * @param {string} typed
   */
  function checkRecoveryCode(userId, factor, typed) {
    const code = normalizeRecoveryCode(typed);
    const index = code ? findRecoveryCodeHash(factor.recoveryCodes, hashRecoveryCode(keys, userId, code)) : -1;
    if (index < 0) {
      return { refusal: REFUSALS.recoveryCodeInvalid };
    }
    return { method: "recoveryCode", changes: { recoveryCodes: factor.recoveryCodes.filter((_, at) => at !== index) } };
  }

  /**
   * Proves the session's second factor in the caller's transaction. While the
   * account waits after wrong codes, nothing is checked. A refused proof counts
   * one more failure; an accepted one forgets them, uses up its code, confirms
   * a factor still being set up, applies the caller's changes and marks the
   * session.
   * @param {import("../types.js").AuthLocalBackendTransaction} tx
   * @param {{ userId: string, sessionId: string }} session
   * @param {object} factor The account's factor, as `secondFactors.find` held it.
   * @param {{ code: string } | { recoveryCode: string }} proof
   * @param {object} [changes]
   */
  async function prove(tx, session, factor, proof, changes = {}) {
    const now = Date.now();
    const waitMs = signInWaitMs(factor, now);
    if (waitMs > 0) {
      return { waitMs };
    }
    const checked = Object.hasOwn(proof, "recoveryCode")
      ? checkRecoveryCode(session.userId, factor, proof.recoveryCode)
      : checkCode(session.userId, factor, proof.code, now);
    const at = new Date(now).toISOString();
    if (checked.refusal) {
      await tx.secondFactors.save({ ...factor, ...nextFailures(config.signInThrottle, factor, now), updatedAt: at });
      return { refusal: checked.refusal };
    }
    const proved = { ...factor, ...checked.changes, ...changes, ...NO_FAILURES, confirmedAt: factor.confirmedAt || at, updatedAt: at };
    await tx.secondFactors.save(proved);
    await tx.sessions.markSecondFactorProved(session.sessionId, at);
    return { factor: proved, method: checked.method, verifiedAt: at };
  }

  /**
   * Proves the session's second factor with the account's confirmed factor.
   * @param {import("../types.js").AuthLocalBackendTransaction} tx
   * @param {{ userId: string, sessionId: string }} session
   * @param {{ code: string } | { recoveryCode: string }} proof
   * @param {object} [changes]
   */
  async function proveConfirmed(tx, session, proof, changes = {}) {
    const factor = await tx.secondFactors.find(session.userId);
    return factor?.confirmedAt ? prove(tx, session, factor, proof, changes) : { refusal: REFUSALS.notSetUp };
  }

  /** Throws a refused outcome's error after its transaction, so the failure it counted is kept, and records it. */
  async function refuseFailed(outcome, session) {
    if (outcome.waitMs) {
      await recordEvent("failed", session, { reason: "locked" });
      throw secondFactorLockedError(outcome.waitMs);
    }
    if (outcome.refusal) {
      if (outcome.refusal.reason) {
        await recordEvent("failed", session, { reason: outcome.refusal.reason });
      }
      throw secondFactorError(outcome.refusal);
    }
  }

  /** New recovery codes: the codes to show once, and the hashes to keep. */
  function newRecoveryCodes(userId) {
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode());
    return { recoveryCodes, hashes: recoveryCodes.map((code) => hashRecoveryCode(keys, userId, normalizeRecoveryCode(code))) };
  }

  async function getSecondFactorStatus(request) {
    const session = await signedInSession(request);
    const [factor] = await backend.withTransaction((tx) => tx.secondFactors.findMany([session.userId]));
    const enrolled = Boolean(factor?.confirmedAt);
    return {
      enrolled,
      enrolledAt: enrolled ? factor.confirmedAt : null,
      recoveryCodesLeft: enrolled ? factor.recoveryCodes.length : 0,
      verifiedAt: session.secondFactorAt || null
    };
  }

  /** Starts setting up an authenticator, replacing a setup the person never confirmed; its failures are kept. */
  async function startSecondFactorSetup(request) {
    const session = await signedInSession(request);
    const secret = newAuthenticatorSecret();
    const started = await backend.withTransaction(async (tx) => {
      const existing = await tx.secondFactors.find(session.userId);
      if (existing?.confirmedAt) {
        return false;
      }
      const now = new Date().toISOString();
      await tx.secondFactors.save({
        userId: session.userId,
        secretSealed: sealSecret(keys, session.userId, secret),
        confirmedAt: "",
        lastUsedStep: 0,
        recoveryCodes: [],
        failures: existing?.failures ?? 0,
        lastFailedAt: existing?.lastFailedAt ?? "",
        lockedUntil: existing?.lockedUntil ?? "",
        createdAt: now,
        updatedAt: now
      });
      return true;
    });
    if (!started) {
      throw secondFactorError(REFUSALS.alreadySetUp);
    }
    await recordEvent("setupStarted", session);
    return {
      secret,
      otpauthUrl: buildOtpauthUrl({ secret, issuer, accountName: session.email }),
      issuer,
      accountName: session.email
    };
  }

  /** Confirms a started setup with the authenticator's first code, and answers its recovery codes once. */
  async function confirmSecondFactorSetup(request, input) {
    const session = await signedInSession(request);
    const { recoveryCodes, hashes } = newRecoveryCodes(session.userId);
    const outcome = await backend.withTransaction(async (tx) => {
      const factor = await tx.secondFactors.find(session.userId);
      if (!factor) {
        return { refusal: REFUSALS.setupNotStarted };
      }
      if (factor.confirmedAt) {
        return { refusal: REFUSALS.alreadySetUp };
      }
      return prove(tx, session, factor, { code: String(input.code ?? "") }, { recoveryCodes: hashes });
    });
    await refuseFailed(outcome, session);
    sessions.forgetRequestAuthentication(request);
    await recordEvent("setupConfirmed", session);
    return { recoveryCodes, verifiedAt: outcome.verifiedAt };
  }

  async function verifySecondFactor(request, input) {
    const session = await signedInSession(request);
    const proof = readProof(input);
    const outcome = await backend.withTransaction((tx) => proveConfirmed(tx, session, proof));
    await refuseFailed(outcome, session);
    sessions.forgetRequestAuthentication(request);
    const recoveryCodesLeft = outcome.factor.recoveryCodes.length;
    await recordEvent("verified", session, { method: outcome.method, recoveryCodesLeft });
    return { verifiedAt: outcome.verifiedAt, method: outcome.method, recoveryCodesLeft };
  }

  async function replaceSecondFactorRecoveryCodes(request, input) {
    const session = await signedInSession(request);
    const proof = readProof(input);
    const { recoveryCodes, hashes } = newRecoveryCodes(session.userId);
    const outcome = await backend.withTransaction((tx) => proveConfirmed(tx, session, proof, { recoveryCodes: hashes }));
    await refuseFailed(outcome, session);
    sessions.forgetRequestAuthentication(request);
    await recordEvent("recoveryCodesReplaced", session, { method: outcome.method });
    return { recoveryCodes, verifiedAt: outcome.verifiedAt };
  }

  /** Removes the person's authenticator; every session of theirs must prove a second factor again. */
  async function removeSecondFactor(request, input) {
    const session = await signedInSession(request);
    const proof = readProof(input);
    const outcome = await backend.withTransaction(async (tx) => {
      const proved = await proveConfirmed(tx, session, proof);
      if (proved.factor) {
        await tx.secondFactors.delete(session.userId);
        await tx.sessions.clearSecondFactorForUser(session.userId);
      }
      return proved;
    });
    await refuseFailed(outcome, session);
    sessions.forgetRequestAuthentication(request);
    await recordEvent("removed", session, { method: outcome.method });
    return { ok: true };
  }

  /**
   * The given accounts that have an authenticator set up.
   * @param {{ userIds: string[] }} input
   */
  async function listSecondFactors({ userIds }) {
    if (!Array.isArray(userIds)) {
      throw new TypeError("listSecondFactors() takes { userIds } with an array of local account ids.");
    }
    const factors = await backend.withTransaction((tx) => tx.secondFactors.findMany(userIds.map(String)));
    return factors.filter((factor) => factor.confirmedAt).map((factor) => ({ userId: factor.userId, enrolledAt: factor.confirmedAt }));
  }

  /**
   * Removes an account's authenticator for the application, which decides who
   * may; every session of the account must prove a second factor again.
   * @param {{ userId: string, byUserId: string }} input
   */
  async function resetSecondFactor({ userId, byUserId }) {
    const id = String(userId ?? "").trim();
    const by = String(byUserId ?? "").trim();
    if (!id || !by) {
      throw new TypeError("resetSecondFactor() takes the userId whose second factor it removes and the byUserId who removes it.");
    }
    const reset = await backend.withTransaction(async (tx) => {
      const removed = await tx.secondFactors.delete(id);
      await tx.sessions.clearSecondFactorForUser(id);
      return removed > 0;
    });
    if (reset) {
      await recordEvent("reset", { userId: id, ip: "" }, { byUserId: by });
    }
    return { reset };
  }

  return Object.freeze({
    getSecondFactorStatus,
    startSecondFactorSetup,
    confirmSecondFactorSetup,
    verifySecondFactor,
    replaceSecondFactorRecoveryCodes,
    removeSecondFactor,
    listSecondFactors,
    resetSecondFactor
  });
}

export { createLocalSecondFactor, createLoggedSecondFactorEvents };
