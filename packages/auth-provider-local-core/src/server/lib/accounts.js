import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "@jskit-ai/auth-core/shared/authConstraints";
import { ensureDevAuthExchangeAvailable, isDevAuthBootstrapEnabled } from "@jskit-ai/auth-core/server/devAuth";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { AUTH_TEXTS, authFieldErrorDetails, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { DEV_AUTH_SESSION_PURPOSE, buildAuthPayload, buildAuthResult, findExistingAppProfile } from "./authPayloads.js";
import { createId } from "./tokens.js";

/** An account created through a provider has no password until recovery sets one. */
const NO_PASSWORD = Object.freeze({ algorithm: "", version: "", salt: "", hash: "" });

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} AuthProfileProjector */

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

function validatePasswordInput(password) {
  const normalizedPassword = String(password || "");
  if (
    normalizedPassword.length < AUTH_PASSWORD_MIN_LENGTH ||
    normalizedPassword.length > AUTH_PASSWORD_MAX_LENGTH
  ) {
    const params = { min: AUTH_PASSWORD_MIN_LENGTH };
    throw new AppError(400, "Password must be at least 8 characters.", {
      code: "auth.local.password.tooShort",
      params,
      details: {
        fieldErrors: {
          password: "Password must be at least 8 characters."
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
 * The accounts of local auth: registering one, signing in with its password
 * or as a dev user, and renaming it.
 * @param {object} dependencies
 * @param {boolean} dependencies.appProfileProjection True when the application keeps profiles.
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("../types.js").AuthLocalPasswords} dependencies.passwords
 * @param {AuthProfileProjector} dependencies.profileProjector
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalAccounts({ appProfileProjection, backend, config, invitationContextResolver, passwords, profileProjector, sessions }) {
  const { devAuth } = config;

  async function resolveProfileOptionsForRegistration(input, email) {
    const invitation = normalizeInvitationInput(input.invitation);
    if (!invitation) {
      return {};
    }

    const resolvedInvitation = await invitationContextResolver.resolveInvitationContext({ ...invitation, email });

    return {
      source: resolvedInvitation?.source || "workspace-invite",
      invitation: resolvedInvitation
    };
  }

  async function register(input) {
    const email = validateEmailInput(input.email);
    validatePasswordInput(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);
    const profileOptions = await resolveProfileOptionsForRegistration(input, email);
    const password = await passwords.hashPassword(input.password);
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

  async function login(input) {
    const email = validateEmailInput(input.email);
    const password = String(input.password || "");
    return backend.withTransaction(async (tx) => {
      const user = await tx.users.findByEmail(email);
      if (!user || user.disabled || !hasPassword(user) || !(await passwords.verifyPassword(password, user.password))) {
        throw createAuthError(AUTH_TEXTS.invalidCredentials);
      }
      const session = await sessions.createSessionForUser(tx, user);
      return buildAuthPayload({ user, session, profileProjector });
    });
  }

  function devAuthBootstrapEnabled() {
    return isDevAuthBootstrapEnabled(devAuth);
  }

  async function devLoginAs(request, input) {
    ensureDevAuthExchangeAvailable(devAuth, request);
    const userId = String(input.userId || "").trim();
    const email = normalizeEmail(input.email || "");
    if (!userId && !email) {
      throw devLoginAsValidationError({
        userId: AUTH_TEXTS.devUserRequired,
        email: AUTH_TEXTS.devUserRequired
      });
    }

    return backend.withTransaction(async (tx) => {
      let user = userId ? await tx.users.findById(userId) : null;
      if (!user && email) {
        user = await tx.users.findByEmail(email);
      }
      if (!user || user.disabled) {
        throw devLoginAsUserNotFound({ email, userId });
      }
      const appProfile = await findExistingAppProfile(user, profileProjector);
      if (appProfileProjection && !appProfile) {
        throw devLoginAsUserNotFound({ email, userId });
      }
      const session = await sessions.createSessionForUser(tx, user, {
        purpose: DEV_AUTH_SESSION_PURPOSE
      });
      return buildAuthResult({ user, session, appProfile });
    });
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
    return backend.withTransaction(async (tx) => {
      const user = await tx.users.updateProfile(authResult.actor.providerUserId, { displayName });
      if (!user) {
        throw createAuthError(AUTH_TEXTS.sessionRequired);
      }
      return buildAuthPayload({ user, session: null, profileProjector });
    });
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
  validateEmailInput,
  validatePasswordInput
};
