import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_PASSWORD_MAX_LENGTH } from "@jskit-ai/auth-core/shared/authConstraints";
import { ensureDevAuthExchangeAvailable, isDevAuthBootstrapEnabled } from "@jskit-ai/auth-core/server/devAuth";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { AUTH_TEXTS, authFieldErrorDetails, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { invitationAsGiven } from "@jskit-ai/auth-core/server/authExtensions";
import { DEV_AUTH_SESSION_PURPOSE, buildAuthPayload, buildAuthResult, buildProfileChangePayload, findExistingAppProfile } from "./authPayloads.js";
import { forgottenFailuresBefore, recordSignInFailure, signInLockedError, signInWaitMs } from "./signInThrottle.js";
import { createId } from "./tokens.js";

/** An account created through a provider has no password until recovery sets one. */
const NO_PASSWORD = Object.freeze({ algorithm: "", version: "", salt: "", hash: "" });

function normalizeDisplayName(value, email) {
  const displayName = String(value || "").trim();
  if (displayName) {
    return displayName;
  }
  return email.split("@")[0] || "User";
}

/**
 * Accounts created through a provider store NO_PASSWORD; any other stored
 * record, in whatever format the password strategy uses, is a password.
 */
function hasPassword(user) {
  const record = user?.password;
  return record && typeof record === "object" ? Boolean(record.hash) : Boolean(record);
}

/**
 * Refuses a password shorter than `minLength` (the configured
 * AUTH_LOCAL_PASSWORD_MIN_LENGTH) or longer than local auth stores.
 * @param {unknown} password
 * @param {number} minLength
 */
function validatePasswordInput(password, minLength) {
  const normalizedPassword = String(password || "");
  if (normalizedPassword.length < minLength || normalizedPassword.length > AUTH_PASSWORD_MAX_LENGTH) {
    const params = { min: minLength };
    const message = `Password must be at least ${minLength} characters.`;
    throw new AppError(400, message, {
      code: "auth.local.password.tooShort",
      params,
      details: {
        fieldErrors: {
          password: message
        },
        fieldErrorCodes: {
          password: { code: "auth.local.password.tooShort", params }
        }
      }
    });
  }
}

function validateEmailInput(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    throw new AppError(400, "Enter a valid email address.", {
      code: "auth.local.email.invalid",
      details: {
        fieldErrors: {
          email: "Enter a valid email address."
        },
        fieldErrorCodes: {
          email: { code: "auth.local.email.invalid", params: {} }
        }
      }
    });
  }
  return normalized;
}

/** fields: { field: AUTH_TEXTS entry }; the error says the first field's text. */
function devLoginAsValidationError(fields = {}) {
  const [first = AUTH_TEXTS.devUserRequired] = Object.values(fields);
  return createAuthError(first, {
    details: authFieldErrorDetails(fields)
  });
}

function devLoginAsUserNotFound({ email = "", userId = "" } = {}) {
  return devLoginAsValidationError({
    ...(userId ? { userId: AUTH_TEXTS.devUserNotFound } : {}),
    ...(email ? { email: AUTH_TEXTS.devUserNotFound } : {})
  });
}

function normalizeInvitationInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const token = String(value.token || value.inviteToken || "").trim();
  if (!token) {
    return null;
  }
  return {
    token,
    source: String(value.source || "workspace-invite").trim() || "workspace-invite"
  };
}

/**
 * The profile options an invitation gives a new account: none without one.
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} invitationContextResolver
 * @param {unknown} invitationInput
 * @param {string} email
 */
async function resolveRegistrationProfileOptions(invitationContextResolver, invitationInput, email) {
  const invitation = normalizeInvitationInput(invitationInput);
  if (!invitation) {
    return {};
  }
  const resolvedInvitation = await invitationContextResolver.resolveInvitationContext({ ...invitation, email });
  return {
    source: resolvedInvitation?.source || "workspace-invite",
    invitation: resolvedInvitation
  };
}

/**
 * The accounts of local auth: registering one (which waits for its email to
 * be confirmed while config.emailConfirmation is on, unless an invitation sent
 * to that email or the first account's setup code admits it, or the
 * application's confirmation mode confirms it without a link), signing in with its
 * password (failures slow the account down, as config.signInThrottle says) or
 * as a dev user, and renaming it.
 * @param {object} dependencies
 * @param {boolean} dependencies.appProfileProjection True when the application keeps profiles.
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {ReturnType<typeof import("./emailConfirmation.js").createLocalEmailConfirmation>} dependencies.emailConfirmation
 * @param {import("../types.js").AuthLocalFirstAccountSetup} dependencies.firstAccountSetup
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("../types.js").AuthLocalPasswords} dependencies.passwords
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalAccounts({
  appProfileProjection,
  backend,
  config,
  emailConfirmation,
  firstAccountSetup,
  invitationContextResolver,
  passwords,
  profileProjector,
  sessions
}) {
  const { devAuth } = config;

  // With self-registration off, an account registers only by an invitation a feature resolved (one passed through as
  // given proves nothing), or as the app's first account.
  async function admitClosedRegistration(profileOptions) {
    if (invitationContextResolver !== invitationAsGiven && profileOptions.invitation) return;
    if (!(await backend.withTransaction((tx) => tx.users.hasAny()))) return;
    throw new AppError(403, "This app's accounts are by invitation only.", { code: "auth.local.register.closed" });
  }

  // A feature's resolver gives an invitation only while it can be used, so one it resolved that was sent to this
  // email and has not expired proves the email: its link reached that address. One passed through as given, or one
  // whose resolver does not say whom it was sent to, proves nothing.
  function invitationProvesEmail(invitation, email) {
    if (invitationContextResolver === invitationAsGiven || !invitation?.email) return false;
    if (normalizeEmail(invitation.email) !== email) return false;
    return invitation.expiresAt == null || new Date(invitation.expiresAt).getTime() > Date.now();
  }

  async function register(input) {
    const email = validateEmailInput(input.email);
    validatePasswordInput(input.password, config.passwordMinLength);
    const displayName = normalizeDisplayName(input.displayName, email);
    const firstAccount = await firstAccountSetup.admitRegistration(input.setupCode);
    // Checked now, so a registration with an invitation it cannot use is refused at once.
    const profileOptions = await resolveRegistrationProfileOptions(invitationContextResolver, input.invitation, email);
    if (!config.selfRegistration) await admitClosedRegistration(profileOptions);
    const password = await passwords.hashPassword(input.password);
    // The first account, admitted by the setup code only the operator can read, and an invited person need no link,
    // nor does a registration the application's confirmation mode chose to confirm without one.
    const emailProven = firstAccount || invitationProvesEmail(profileOptions.invitation, email);
    if (config.emailConfirmation && !emailProven && !(await emailConfirmation.confirmsWithoutLink(email))) {
      return emailConfirmation.begin({ email, displayName, password, invitation: normalizeInvitationInput(input.invitation) });
    }
    const result = await backend.withTransaction(async (tx) => {
      const existing = await tx.users.findByEmail(email);
      if (existing) {
        throw new AppError(409, "An account already exists for this email.", { code: "auth.local.register.emailTaken" });
      }
      const user = await tx.users.create({
        id: createId("usr"),
        email,
        displayName,
        password
      });
      return {
        user,
        session: await sessions.createSessionForUser(tx, user)
      };
    });
    firstAccountSetup.accountCreated();
    return {
      ...(await buildAuthPayload({
        user: result.user,
        session: result.session,
        profileProjector,
        profileOptions
      })),
      requiresEmailConfirmation: false
    };
  }

  /**
   * Signs in with a password. Each account's failures are counted, whether or
   * not the account exists, so the wait they cause says nothing about which
   * accounts exist; while an account waits its password is not checked. A
   * successful sign-in, or a password reset, forgets the failures.
   */
  async function login(input) {
    const email = validateEmailInput(input.email);
    const password = String(input.password || "");
    const outcome = await backend.withTransaction(async (tx) => {
      const now = Date.now();
      const failures = await tx.signInFailures.find(email);
      const waitMs = signInWaitMs(failures, now);
      if (waitMs > 0) {
        return { waitMs };
      }
      const user = await tx.users.findByEmail(email);
      // Whatever config.emailConfirmation says now: a registration made while it was on still waits.
      if (!user && (await emailConfirmation.isWaitingWithPassword(tx, email, (registration) =>
        passwords.verifyPassword(password, registration.password)))) {
        return { unconfirmed: true };
      }
      if (!user || user.disabled || !hasPassword(user) || !(await passwords.verifyPassword(password, user.password))) {
        await tx.signInFailures.deleteBefore(forgottenFailuresBefore(now));
        await tx.signInFailures.save(recordSignInFailure(config.signInThrottle, failures, email, now));
        return { failed: true };
      }
      if (failures) {
        await tx.signInFailures.clear(email);
      }
      return { user, session: await sessions.createSessionForUser(tx, user) };
    });
    // Refused after the transaction, so the failure it records is kept.
    if (outcome.waitMs) {
      throw signInLockedError(outcome.waitMs);
    }
    if (outcome.failed) {
      throw createAuthError(AUTH_TEXTS.invalidCredentials);
    }
    if (outcome.unconfirmed) {
      throw createAuthError(AUTH_TEXTS.emailUnconfirmed);
    }
    // After the transaction, as register does: the profile projector works in transactions of its own, so a sign-in
    // that synchronized the profile inside this one held two database connections at once.
    return buildAuthPayload({ user: outcome.user, session: outcome.session, profileProjector });
  }

  function devAuthBootstrapEnabled() {
    return isDevAuthBootstrapEnabled(devAuth);
  }

  async function devLoginAs(input, request) {
    ensureDevAuthExchangeAvailable(devAuth, request);
    const userId = String(input.userId || "").trim();
    const email = normalizeEmail(input.email || "");
    if (!userId && !email) {
      throw devLoginAsValidationError({
        userId: AUTH_TEXTS.devUserRequired,
        email: AUTH_TEXTS.devUserRequired
      });
    }

    // The user is found, its app profile read and its session created one after the other, never the profile inside a
    // transaction: the profile projector reads on a connection of its own, so a sign-in that read it inside one held
    // two database connections at once, and as many sign-ins at once as the pool has connections waited for ever.
    const user = await backend.withTransaction(async (tx) => {
      const userById = userId ? await tx.users.findById(userId) : null;
      return userById || (email ? tx.users.findByEmail(email) : null);
    });
    if (!user || user.disabled) {
      throw devLoginAsUserNotFound({ email, userId });
    }
    const appProfile = await findExistingAppProfile(user, profileProjector);
    if (appProfileProjection && !appProfile) {
      throw devLoginAsUserNotFound({ email, userId });
    }
    const session = await backend.withTransaction((tx) => sessions.createSessionForUser(tx, user, {
      purpose: DEV_AUTH_SESSION_PURPOSE
    }));
    return buildAuthResult({ user, session, appProfile });
  }

  async function updateDisplayName(request, input) {
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    const displayName = String(input.displayName || "").trim();
    if (!displayName) {
      throw createAuthError(AUTH_TEXTS.displayNameRequired);
    }
    const user = await backend.withTransaction((tx) => tx.users.updateProfile(authResult.actor.providerUserId, { displayName }));
    if (!user) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    // After the transaction, so the request holds one database connection at a time (see login).
    const changed = await buildProfileChangePayload({ user, profileProjector });
    sessions.updateRequestActor(request, changed.actor);
    return changed;
  }

  return Object.freeze({
    register,
    login,
    isDevAuthBootstrapEnabled: devAuthBootstrapEnabled,
    devLoginAs,
    updateDisplayName
  });
}

export {
  NO_PASSWORD,
  createLocalAccounts,
  hasPassword,
  normalizeDisplayName,
  resolveRegistrationProfileOptions,
  validateEmailInput,
  validatePasswordInput
};
