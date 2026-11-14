import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";
import { resolveRegistrationProfileOptions, validateEmailInput } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url } from "./tokens.js";

const CONFIRMATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const CONFIRM_BY_LINK = "link";
const CONFIRM_WITHOUT_LINK = "without-link";

/**
 * The confirmation mode while no `auth.local.confirmation-mode` is installed:
 * every registration waits for its link.
 * @type {import("../types.js").AuthLocalConfirmationMode}
 */
async function confirmEveryRegistrationByLink() {
  return CONFIRM_BY_LINK;
}

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

/**
 * The confirmation sender of a test copy (SIDE_EFFECTS is not `live`) in place of the installed
 * `auth.local.confirmation-sender`: it emails nothing and logs the link, which the person testing follows to
 * confirm. The link stays out of the registration's answer, as with a real sender.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").AuthLocalConfirmationSender}
 */
function createSimulatedConfirmationSender(logger) {
  return async function simulateConfirmationEmail({ email, confirmationUrl }) {
    logSimulatedSideEffect(logger, {
      kind: "email",
      summary: `the email confirmation email to ${email}`,
      details: { email, confirmationUrl }
    });
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

function confirmationPasswordInvalidError() {
  const code = "auth.local.register.confirmationPasswordInvalid";
  const message = "That is not the password this registration was made with. Enter the password you registered with, or register again.";
  return new AppError(400, message, {
    code,
    details: {
      fieldErrors: { password: message },
      fieldErrorCodes: { password: { code, params: {} } }
    }
  });
}

/**
 * Registration with email confirmation: registering keeps the account waiting,
 * with no account, profile or session, until the link sent to its email is
 * opened, which creates the account and signs the person in. The link's code is stored only as a hash, works once and expires
 * after a day; asking for a new link replaces it, and registering the email again replaces the waiting registration
 * whole, so a waiting registration never keeps the email from its owner. Confirming needs the link and the waiting
 * registration's password: the link proves the email and the password proves the registration, so whoever registered
 * an email, in whatever order, the account its link creates has a password the person confirming chose. The
 * application's confirmation mode may instead confirm a registration without a link (confirmsWithoutLink).
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalConfirmationMode} dependencies.confirmationMode The
 *   `auth.local.confirmation-mode`, or confirmEveryRegistrationByLink.
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("../types.js").AuthLocalFirstAccountSetup} dependencies.firstAccountSetup
 * @param {import("../types.js").AuthLocalConfirmationSender} dependencies.confirmationSender The
 *   `auth.local.confirmation-sender`, or one made by createLoggedConfirmationSender;
 *   in development without a sender, links also go in the response.
 * @param {import("../types.js").AuthLocalDeliveries} dependencies.deliveries Sends each new
 *   link a resend asks for after its request has answered.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("../types.js").AuthLocalPasswords} dependencies.passwords
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalEmailConfirmation({
  backend,
  config,
  confirmationMode,
  confirmationSender,
  deliveries,
  firstAccountSetup,
  invitationContextResolver,
  logger,
  passwords,
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
   * True when the application's confirmation mode answers exactly "without-link" for this registration: it chose to
   * create the account without proof of the address. Any other answer is a link; one that is neither answer is
   * logged, since the application meant something else.
   * @param {string} email
   */
  async function confirmsWithoutLink(email) {
    const mode = await confirmationMode({ email });
    if (mode !== CONFIRM_BY_LINK && mode !== CONFIRM_WITHOUT_LINK) {
      logger.warn(
        { mode: typeof mode === "string" ? mode : typeof mode },
        'auth.local.confirmation-mode answered neither "link" nor "without-link", so the registration waits for its link.'
      );
    }
    return mode === CONFIRM_WITHOUT_LINK;
  }

  /**
   * Keeps a registration, already validated and with its password hashed,
   * until its email is confirmed. It replaces a registration already waiting
   * for that email, and that registration's link.
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
   * code and the password it registered with, and signs the person in. A wrong
   * password creates nothing and keeps the registration and its link.
   * @param {{ token: string, password: string }} input
   */
  async function confirm(input) {
    const tokenHash = sha256Base64url(String(input.token || "").trim());
    const waiting = await backend.withTransaction((tx) => tx.registrations.findByTokenHash(tokenHash));
    if (!waiting || isExpiredIso(waiting.expiresAt)) {
      throw confirmationInvalidError();
    }
    if (!(await passwords.verifyPassword(String(input.password || ""), waiting.password))) {
      throw confirmationPasswordInvalidError();
    }
    const profileOptions = await resolveRegistrationProfileOptions(
      invitationContextResolver,
      waiting.invitation,
      waiting.email
    );
    const outcome = await backend.withTransaction(async (tx) => {
      // Every save gives a registration a new link code, so the one this code still finds has the password just checked.
      const registration = await tx.registrations.findByTokenHash(tokenHash);
      if (!registration || isExpiredIso(registration.expiresAt)) {
        return { invalid: true };
      }
      await tx.registrations.delete(registration.email);
      if (await tx.users.findByEmail(registration.email)) {
        return { taken: true };
      }
      // The link was sent to the email, so using it confirms the email.
      const user = await tx.users.create({
        id: createId("usr"),
        email: registration.email,
        displayName: registration.displayName,
        password: registration.password,
        emailVerifiedAt: new Date().toISOString()
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
    firstAccountSetup.accountCreated();
    return buildAuthPayload({ user: outcome.user, session: outcome.session, profileProjector, profileOptions });
  }

  /**
   * A new link's code for the registration waiting for this email, replacing its old link; "" when none waits.
   * @param {string} email
   */
  async function renewLink(email) {
    const { token, tokenHash, expiresAt } = newConfirmation();
    const renewed = await backend.withTransaction(async (tx) => {
      const registration = await tx.registrations.findByEmail(email);
      if (!registration || isExpiredIso(registration.expiresAt)) {
        return false;
      }
      await tx.registrations.save({ ...registration, tokenHash, expiresAt });
      return true;
    });
    return renewed ? token : "";
  }

  /**
   * Sends a waiting registration a new link, which replaces the old one; the
   * registration, its password included, stays as it is. An expired
   * registration no longer waits: it registers again. The answer is the same,
   * at once, whether or not a registration waits for that email: the
   * registration is looked up, and its link renewed and emailed, after the
   * answer (deliveries), and a sender's failure is logged instead.
   * Development's `dev-response` delivery puts the link in the answer instead,
   * so it renews the link first.
   * @param {{ email: string }} input
   */
  async function resend(input) {
    const email = validateEmailInput(input.email);
    const resent = {
      ok: true,
      message: "If a registration is waiting for that email, a new confirmation link has been sent.",
      messageCode: "auth.local.register.confirmationResent",
      messageParams: {}
    };
    if (confirmationDelivery === "dev-response") {
      const token = await renewLink(email);
      return { ...resent, ...(token ? await deliver(email, token) : {}) };
    }
    deliveries.send("the email confirmation email", email, async () => {
      const token = await renewLink(email);
      if (token) {
        await deliver(email, token);
      }
    });
    return resent;
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
    confirmsWithoutLink,
    begin,
    confirm,
    resend,
    isWaitingWithPassword
  });
}

export {
  CONFIRMATION_TOKEN_TTL_SECONDS,
  confirmEveryRegistrationByLink,
  createLocalEmailConfirmation,
  createLoggedConfirmationSender,
  createSimulatedConfirmationSender
};
