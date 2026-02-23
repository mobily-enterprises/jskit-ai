import { AppError } from "../../../lib/errors.js";

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
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const message = sanitizeAuthMessage(error?.message, "Authentication failed.");
  const lower = message.toLowerCase();

  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return new AppError(409, "Email is already registered.");
  }

  if (lower.includes("email not confirmed") || lower.includes("confirm your email")) {
    return new AppError(403, "Account exists but email confirmation is required before login.");
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return new AppError(401, "Invalid email or password.");
  }

  if (
    lower.includes("already linked") ||
    lower.includes("identity is already linked") ||
    (lower.includes("identity") && lower.includes("already exists"))
  ) {
    return new AppError(409, "This sign-in method is already linked.");
  }

  if (lower.includes("manual linking is disabled")) {
    return new AppError(
      409,
      "Provider linking is disabled in Supabase. Enable Manual Linking in Supabase Auth settings to link or unlink providers."
    );
  }

  if (
    lower.includes("last identity") ||
    lower.includes("only identity") ||
    (lower.includes("at least one") && lower.includes("identity"))
  ) {
    return new AppError(409, "At least one linked sign-in method must remain available.");
  }

  if (lower.includes("identity") && lower.includes("not found")) {
    return new AppError(409, "This sign-in method is not currently linked.");
  }

  const status = Number.isInteger(Number(fallbackStatus)) ? Number(fallbackStatus) : 400;
  if (status >= 500) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }
  if (status === 401) {
    return new AppError(401, "Invalid email or password.");
  }
  if (status >= 400 && status < 500 && message && message !== "Authentication failed.") {
    return new AppError(status, message);
  }

  return new AppError(status, "Authentication request could not be processed.");
}

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
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
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 429) {
    return new AppError(429, "Too many recovery attempts. Please wait and try again.");
  }

  return new AppError(401, "Recovery link is invalid or has expired.");
}

function mapPasswordUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("same") && message.includes("password")) {
    return validationError({
      password: "New password must be different from the current password."
    });
  }

  return validationError({
    password: "Unable to update password with the provided value."
  });
}

function mapOtpVerifyError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  return new AppError(401, "One-time code is invalid or expired.");
}

function mapProfileUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  return validationError({
    displayName: "Unable to update profile details."
  });
}

function mapCurrentPasswordError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 400 || status === 401 || status === 403) {
    return validationError({
      currentPassword: "Current password is incorrect."
    });
  }

  return validationError({
    currentPassword: "Unable to verify current password."
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
