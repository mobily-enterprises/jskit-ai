import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { hasPassword, validateEmailInput } from "./accounts.js";
import { buildProfileChangePayload } from "./authPayloads.js";
import { signToken, verifySignedToken } from "./tokens.js";

const EMAIL_CHANGE_LINK_TTL_SECONDS = 24 * 60 * 60;
// What the link's signed token is for, so no other token the session secret signs is taken for one.
const EMAIL_CHANGE_PURPOSE = "email-change";
// A password reset's recovery tokens (passwordFlows.js): those sent to the old address end with the change.
const RESET_TOKEN_PREFIX = "rec_";

/**
 * The `auth.local.email-change-sender` default when no feature provides one: in development and test, local auth logs
 * each email-change link and notice instead of emailing them. A staging or production server without one has no email
 * change.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").AuthLocalEmailChangeSender}
 */
function createLoggedEmailChangeSender(logger) {
  return async function logEmailChange(delivery) {
    logger.info(delivery, `Local auth email change: ${delivery.type}.`);
  };
}

/** The refusal of one field, for the form that sent it: its message under its code. */
function fieldRefusal(status, { code, message, field }) {
  return new AppError(status, message, {
    code,
    details: { fieldErrors: { [field]: message }, fieldErrorCodes: { [field]: { code, params: {} } } }
  });
}

const passwordInvalidError = () =>
  fieldRefusal(400, { code: "auth.local.emailChange.passwordInvalid", message: "That is not your password.", field: "password" });
const sameEmailError = () =>
  fieldRefusal(400, { code: "auth.local.emailChange.sameEmail", message: "That is already your email address.", field: "email" });
const emailTakenError = () =>
  fieldRefusal(409, { code: "auth.local.emailChange.emailTaken", message: "An account already exists for this email.", field: "email" });
const linkInvalidError = () => new AppError(400, "This email change link is invalid, used or expired. Ask for the change again.", {
  code: "auth.local.emailChange.linkInvalid"
});

/**
 * Changing an account's email: the signed-in person asks with their password (requestEmailChange), or the
 * application asks for an account it chose (requestEmailChangeForUser). The account keeps the new address as its
 * waiting change, and the new address is sent a link, signed with the session secret, naming the account and the
 * address and working for a day; a newer request replaces the waiting change, so an earlier link stops working. Using
 * the link (confirmEmailChange) changes the email, which the link proved, ends the password resets sent to the old
 * address, and tells the old address. The links and notices go through `auth.local.email-change-sender` after the
 * request has answered (deliveries). The account's sessions stay signed in.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalDeliveries} dependencies.deliveries
 * @param {import("../types.js").AuthLocalEmailChangeSender} dependencies.emailChangeSender
 * @param {import("../types.js").AuthLocalPasswords} dependencies.passwords
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalEmailChange({ backend, config, deliveries, emailChangeSender, passwords, profileProjector, sessions }) {
  if (!emailChangeSender) {
    throw new TypeError("createLocalEmailChange() takes emailChangeSender, the auth.local.email-change-sender that sends its links.");
  }
  const enabled = config.emailChangeDelivery !== "off";

  function linkFor(user, email) {
    const exp = Math.floor(Date.now() / 1000) + EMAIL_CHANGE_LINK_TTL_SECONDS;
    const token = signToken({ purpose: EMAIL_CHANGE_PURPOSE, sub: user.id, email, exp }, config.sessionSecret);
    return `${config.appPublicUrl}/auth/email-change?token=${encodeURIComponent(token)}`;
  }

  /**
   * Keeps the new address as the account's waiting change and sends it the link, once the request has answered.
   * @param {(tx: import("../types.js").AuthLocalBackendTransaction) => Promise<object>} findUser The account, or a refusal.
   * @param {string} email The new address, already checked.
   */
  async function startChange(findUser, email) {
    const user = await backend.withTransaction(async (tx) => {
      const found = await findUser(tx);
      if (found.email === email) {
        throw sameEmailError();
      }
      if (await tx.users.findByEmail(email)) {
        throw emailTakenError();
      }
      return tx.users.updatePendingEmail(found.id, email);
    });
    const confirmationUrl = linkFor(user, email);
    deliveries.send("the email change link", email, () =>
      emailChangeSender({ type: "confirmation", email, currentEmail: user.email, confirmationUrl }));
    return { ok: true, email };
  }

  /**
   * The signed-in person's own change, with their password; an account with no password sets one first, through a
   * password reset.
   * @param {object} request
   * @param {{ email: string, password: string }} input
   */
  async function requestEmailChange(request, input) {
    if (!enabled) return throwUnsupportedAuthOperation("requestEmailChange");
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    const email = validateEmailInput(input.email);
    const password = String(input.password || "");
    const userId = authResult.actor.providerUserId;
    const user = await backend.withTransaction((tx) => tx.users.findById(userId));
    if (!user || !hasPassword(user) || !(await passwords.verifyPassword(password, user.password))) {
      throw passwordInvalidError();
    }
    return startChange(async (tx) => {
      const current = await tx.users.findById(userId);
      if (!current) {
        throw createAuthError(AUTH_TEXTS.sessionRequired);
      }
      return current;
    }, email);
  }

  /**
   * The application's change of an account it chose, such as an operator's for a person who lost their old address:
   * who may ask is the application's decision.
   * @param {{ userId: string, email: string }} input
   */
  async function requestEmailChangeForUser({ userId, email: given } = {}) {
    if (!enabled) return throwUnsupportedAuthOperation("requestEmailChangeForUser");
    const id = String(userId || "").trim();
    if (!id) {
      throw new TypeError("requestEmailChangeForUser() takes the userId of the account whose email changes.");
    }
    const email = validateEmailInput(given);
    return startChange(async (tx) => {
      const user = await tx.users.findById(id);
      if (!user) {
        throw new AppError(404, "There is no such account.", { code: "auth.local.emailChange.accountNotFound" });
      }
      return user;
    }, email);
  }

  /**
   * Uses the link: while it is the account's waiting change, the email changes to it.
   * @param {{ token: string }} input
   */
  async function confirmEmailChange(input) {
    if (!enabled) return throwUnsupportedAuthOperation("confirmEmailChange");
    const payload = verifySignedToken(String(input?.token || ""), config.sessionSecret);
    if (payload?.purpose !== EMAIL_CHANGE_PURPOSE || !payload.sub || !payload.email) {
      throw linkInvalidError();
    }
    const email = String(payload.email);
    const changed = await backend.withTransaction(async (tx) => {
      const user = await tx.users.findById(String(payload.sub));
      if (!user || user.pendingEmail !== email) {
        throw linkInvalidError();
      }
      if (await tx.users.findByEmail(email)) {
        throw emailTakenError();
      }
      const updated = await tx.users.updateEmail(user.id, email);
      await tx.recovery.consumeForUser(user.id, { idPrefix: RESET_TOKEN_PREFIX });
      return { user: updated, oldEmail: user.email };
    });
    deliveries.send("the email change notice", changed.oldEmail, () =>
      emailChangeSender({ type: "notice", email: changed.oldEmail, newEmail: email }));
    // After the transaction, so the request holds one database connection at a time: the application's profile
    // takes the new email now, rather than at the account's next request.
    await buildProfileChangePayload({ user: changed.user, profileProjector });
    return { ok: true, email };
  }

  return Object.freeze({
    requestEmailChange,
    requestEmailChangeForUser,
    confirmEmailChange
  });
}

export { createLocalEmailChange, createLoggedEmailChangeSender };
