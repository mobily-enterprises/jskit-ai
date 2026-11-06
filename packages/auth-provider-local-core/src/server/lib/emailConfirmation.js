import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { resolveRegistrationProfileOptions, validateEmailInput } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url } from "./tokens.js";

const CONFIRMATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * The confirmation sender while no `auth.local.confirmation-sender` is
 * installed: it logs each link, which development also shows on the sign-in screen.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").AuthLocalConfirmationSender}
 */
function createLoggedConfirmationSender(logger) {
  return async function logConfirmationLink({ email, confirmationUrl }) {
    logger.info({ email, confirmationUrl }, "Local auth email confirmation URL created.");
  };
}

function emailTakenError() {
  return new AppError(409, "An account already exists for this email.", { code: "auth.local.register.emailTaken" });
}

function confirmationInvalidError() {
  return new AppError(400, "This confirmation link is invalid or has expired. Register again to get a new one.", {
    code: "auth.local.register.confirmationInvalid"
  });
}

/**
 * Registration with email confirmation: registering keeps the account waiting,
 * with no account, profile or session, until the link sent to its email is
 * opened, which creates the account and signs the person in. The link's code is stored only as a hash, works once and expires
 * after a day; registering again or asking for a new link replaces it.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("../types.js").AuthLocalConfirmationSender} dependencies.confirmationSender The
 *   `auth.local.confirmation-sender`, or one made by createLoggedConfirmationSender;
 *   in development without a sender, links also go in the response.
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalEmailConfirmation({
  backend,
  config,
  confirmationSender,
  invitationContextResolver,
  profileProjector,
  sessions
}) {
  const { confirmationDelivery } = config;

  function newConfirmation() {
    const token = randomToken(32);
    return {
      token,
      tokenHash: sha256Base64url(token),
      expiresAt: isoFromNow(CONFIRMATION_TOKEN_TTL_SECONDS)
    };
  }

  // Development without a sender also shows the link, so it can be opened
  // without an email.
  async function deliver(email, token) {
    const confirmationUrl = `${config.appPublicUrl}/auth/login?confirmation_token=${encodeURIComponent(token)}`;
    await confirmationSender({ email, confirmationUrl });
    return confirmationDelivery === "dev-response" ? { confirmationUrl } : {};
  }

  /**
   * Keeps a registration, already validated and with its password hashed,
   * until its email is confirmed.
   * @param {{ email: string, displayName: string, password: object, invitation: object | null }} registration
   */
  async function begin({ email, displayName, password, invitation }) {
    const { token, tokenHash, expiresAt } = newConfirmation();
    await backend.withTransaction(async (tx) => {
      if (await tx.users.findByEmail(email)) {
        throw emailTakenError();
      }
      const now = new Date().toISOString();
      await tx.registrations.deleteExpired(now);
      await tx.registrations.save({ email, displayName, password, invitation, tokenHash, createdAt: now, expiresAt });
    });
    return {
      actor: null,
      session: null,
      requiresEmailConfirmation: true,
      email,
      ...(await deliver(email, token))
    };
  }

  /**
   * Creates the account a registration was waiting to create, from its link's
   * code, and signs the person in.
   * @param {{ token: string }} input
   */
  async function confirm(input) {
    const tokenHash = sha256Base64url(String(input.token || "").trim());
    const waiting = await backend.withTransaction((tx) => tx.registrations.findByTokenHash(tokenHash));
    if (!waiting || isExpiredIso(waiting.expiresAt)) {
      throw confirmationInvalidError();
    }
    const profileOptions = await resolveRegistrationProfileOptions(
      invitationContextResolver,
      waiting.invitation,
      waiting.email
    );
    const outcome = await backend.withTransaction(async (tx) => {
      const registration = await tx.registrations.findByTokenHash(tokenHash);
      if (!registration || isExpiredIso(registration.expiresAt)) {
        return { invalid: true };
      }
      await tx.registrations.delete(registration.email);
      if (await tx.users.findByEmail(registration.email)) {
        return { taken: true };
      }
      const user = await tx.users.create({
        id: createId("usr"),
        email: registration.email,
        displayName: registration.displayName,
        password: registration.password
      });
      return { user, session: await sessions.createSessionForUser(tx, user) };
    });
    // Refused after the transaction, so a used-up registration stays deleted.
    if (outcome.invalid) {
      throw confirmationInvalidError();
    }
    if (outcome.taken) {
      throw emailTakenError();
    }
    return buildAuthPayload({ user: outcome.user, session: outcome.session, profileProjector, profileOptions });
  }

  /**
   * Sends a waiting registration a new link, which replaces the old one. The
   * answer is the same whether or not a registration waits for that email.
   * @param {{ email: string }} input
   */
  async function resend(input) {
    const email = validateEmailInput(input.email);
    const { token, tokenHash, expiresAt } = newConfirmation();
    const renewed = await backend.withTransaction(async (tx) => {
      const registration = await tx.registrations.findByEmail(email);
      if (!registration) {
        return false;
      }
      await tx.registrations.save({ ...registration, tokenHash, expiresAt });
      return true;
    });
    return {
      ok: true,
      message: "If a registration is waiting for that email, a new confirmation link has been sent.",
      messageCode: "auth.local.register.confirmationResent",
      messageParams: {},
      ...(renewed ? await deliver(email, token) : {})
    };
  }

  /**
   * True when a registration still waits for this email and the password is
   * the one it chose, so the sign-in is refused as unconfirmed; a wrong
   * password stays an ordinary failed sign-in.
   * @param {import("../types.js").AuthLocalBackendTransaction} tx
   * @param {string} email
   * @param {(registration: import("../types.js").AuthLocalRegistration) => Promise<boolean>} passwordMatches
   */
  async function isWaitingWithPassword(tx, email, passwordMatches) {
    const registration = await tx.registrations.findByEmail(email);
    return Boolean(registration && !isExpiredIso(registration.expiresAt) && (await passwordMatches(registration)));
  }

  return Object.freeze({
    begin,
    confirm,
    resend,
    isWaitingWithPassword
  });
}

export { CONFIRMATION_TOKEN_TTL_SECONDS, createLocalEmailConfirmation, createLoggedConfirmationSender };
