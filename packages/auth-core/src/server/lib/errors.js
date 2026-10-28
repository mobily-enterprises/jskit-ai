const AUTH_POLICY_DENY_REASONS = Object.freeze({
  AUTH_UPSTREAM_UNAVAILABLE: "auth_upstream_unavailable",
  UNAUTHENTICATED: "unauthenticated",
  OWNER_UNRESOLVED: "owner_unresolved",
  FORBIDDEN_OWNER_MISMATCH: "forbidden_owner_mismatch",
  INVALID_AUTH_POLICY: "invalid_auth_policy",
  FORBIDDEN_PERMISSION: "forbidden_permission"
});

// code names the refusal (auth.session.required, auth.policy.permissionDenied...)
// so a client can show it in the user's language; message stays the English.
function createAuthPolicyError(status, message, { code, params = {} } = {}) {
  const normalizedStatus = Number(status) || 500;
  const error = new Error(String(message || "Request failed."));
  error.name = "AuthPolicyError";
  error.status = normalizedStatus;
  error.statusCode = normalizedStatus;
  error.code = code;
  error.params = params && typeof params === "object" ? { ...params } : {};
  return error;
}

export { AUTH_POLICY_DENY_REASONS, createAuthPolicyError };
