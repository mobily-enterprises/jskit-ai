import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";

const TRANSIENT_AUTH_MESSAGE_PARTS = [
  "network",
  "fetch",
  "timeout",
  "timed out",
  "econn",
  "enotfound",
  "socket",
  "temporar"
];

const validationError = createValidationError;

function isTransientAuthMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return TRANSIENT_AUTH_MESSAGE_PARTS.some((part) => normalized.includes(part));
}

function isTransientSupabaseError(error) {
  if (!error) {
    return false;
  }

  const status = Number(error.status || error.statusCode);
  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  return isTransientAuthMessage(error.message);
}

function sanitizeAuthMessage(message, fallback = "Authentication request could not be processed.") {
  const normalized = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 320);
}

function mapAuthError(error, fallbackStatus) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  const statusFromError = Number(error?.status || error?.statusCode);
  const message = sanitizeAuthMessage(error?.message, "Authentication failed.");
  const lower = message.toLowerCase();

  if (statusFromError === 429 || lower.includes("rate limit")) {
    return new AppError(429, "Too many authentication attempts. Please wait and try again.", {
      code: "auth.supabase.login.rateLimited"
    });
  }

  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return new AppError(409, "Email is already registered.", { code: "auth.supabase.register.emailTaken" });
  }

  if (lower.includes("email not confirmed") || lower.includes("confirm your email")) {
    return new AppError(403, "Account exists but email confirmation is required before login.", {
      code: "auth.supabase.login.emailUnconfirmed"
    });
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return createAuthError(AUTH_TEXTS.invalidCredentials);
  }

  if (
    lower.includes("already linked") ||
    lower.includes("identity is already linked") ||
    (lower.includes("identity") && lower.includes("already exists"))
  ) {
    return new AppError(409, "This sign-in method is already linked.", { code: "auth.supabase.link.alreadyLinked" });
  }

  if (lower.includes("manual linking is disabled")) {
    return new AppError(
      409,
      "Provider linking is disabled in Supabase. Enable Manual Linking in Supabase Auth settings to link or unlink providers.",
      { code: "auth.supabase.link.manualLinkingDisabled" }
    );
  }

  if (
    lower.includes("last identity") ||
    lower.includes("only identity") ||
    (lower.includes("at least one") && lower.includes("identity"))
  ) {
    return new AppError(409, "At least one linked sign-in method must remain available.", {
      code: "auth.supabase.link.lastIdentity"
    });
  }

  if (lower.includes("identity") && lower.includes("not found")) {
    return new AppError(409, "This sign-in method is not currently linked.", { code: "auth.supabase.link.notLinked" });
  }

  const status = Number.isInteger(statusFromError)
    ? statusFromError
    : Number.isInteger(Number(fallbackStatus))
      ? Number(fallbackStatus)
      : 400;
  if (status >= 500) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }
  if (status === 401) {
    return createAuthError(AUTH_TEXTS.invalidCredentials);
  }
  return new AppError(status, "Authentication request could not be processed.", { code: "auth.supabase.request.failed" });
}

function isUserNotFoundLikeAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("user not found") ||
    message.includes("no user") ||
    message.includes("email not found") ||
    message.includes("signup is disabled") ||
    message.includes("signups not allowed")
  );
}

function mapRecoveryError(error) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 429) {
    return new AppError(429, "Too many recovery attempts. Please wait and try again.", {
      code: "auth.supabase.recovery.rateLimited"
    });
  }

  return new AppError(401, "Recovery link is invalid or has expired.", { code: "auth.supabase.recovery.linkInvalid" });
}

function mapPasswordUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("same") && message.includes("password")) {
    return createValidationError({
      password: {
        code: "auth.supabase.password.sameAsCurrent",
        message: "New password must be different from the current password."
      }
    });
  }

  return createValidationError({
    password: { code: "auth.supabase.password.updateFailed", message: "Unable to update password with the provided value." }
  });
}

function mapOtpVerifyError(error) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  return new AppError(401, "One-time code is invalid or expired.", { code: "auth.supabase.otp.invalid" });
}

function mapProfileUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  return validationError({
    displayName: { code: "auth.supabase.profile.updateFailed", message: "Unable to update profile details." }
  });
}

function mapCurrentPasswordError(error) {
  if (isTransientSupabaseError(error)) {
    return createAuthError(AUTH_TEXTS.sessionUnavailable);
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 400 || status === 401 || status === 403) {
    return validationError({
      currentPassword: { code: "auth.supabase.password.currentIncorrect", message: "Current password is incorrect." }
    });
  }

  return validationError({
    currentPassword: { code: "auth.supabase.password.currentUnverified", message: "Unable to verify current password." }
  });
}

export {
  isTransientAuthMessage,
  isTransientSupabaseError,
  sanitizeAuthMessage,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError
};
