import { asObject } from "./objectUtils.js";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/** The onPolicyDenied default when an application passes none: a denial is not reported. */
function ignorePolicyDenial() {}

/** The resolveContext default when an application passes none: a request has no policy context. */
function resolveNoPolicyContext() {
  return null;
}

function assertAuthPolicyDeps(deps = {}) {
  const source = asObject(deps);
  const resolveActor = assertFunction(source.resolveActor, "resolveActor");
  const hasPermission = assertFunction(source.hasPermission, "hasPermission");

  return {
    resolveActor,
    // readable-check: allow method-probe - input validation: the callbacks an application passes authPolicyPlugin
    resolveContext: typeof source.resolveContext === "function" ? source.resolveContext : resolveNoPolicyContext,
    hasPermission,
    // readable-check: allow method-probe - input validation: the callbacks an application passes authPolicyPlugin
    onPolicyDenied: typeof source.onPolicyDenied === "function" ? source.onPolicyDenied : ignorePolicyDenial
  };
}

const textOr = (value) => (typeof value === "string" ? value : "");

/**
 * How the session was signed in, each field "" when the provider does not know it, or null when the provider keeps
 * none.
 * @param {unknown} value
 * @returns {import("../types.js").AuthSessionSignIn | null}
 */
function normalizeSessionSignIn(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return Object.freeze({
    at: textOr(source.at),
    ip: textOr(source.ip),
    userAgent: textOr(source.userAgent),
    purpose: textOr(source.purpose)
  });
}

/**
 * When the account's password and email last changed, each "" when not since the provider kept it, or null when the
 * provider keeps neither.
 * @param {unknown} value
 * @returns {import("../types.js").AuthCredentialsChangedAt | null}
 */
function normalizeCredentialsChangedAt(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return Object.freeze({
    password: textOr(source.password),
    email: textOr(source.email)
  });
}

function normalizeActorResolution(result) {
  const source = asObject(result);

  return {
    authenticated: Boolean(source.authenticated),
    actor: Object.hasOwn(source, "actor") ? source.actor : null,
    // When the session last proved its second factor, as ISO text, or "".
    secondFactorAt: textOr(source.secondFactorAt),
    sessionSignIn: normalizeSessionSignIn(source.signIn),
    credentialsChangedAt: normalizeCredentialsChangedAt(source.credentialsChangedAt),
    transientFailure: Boolean(source.transientFailure),
    // "bearer" when the provider signed the request in by its Authorization header, as a bearer route requires.
    credentials: source.credentials === "bearer" ? "bearer" : "cookies",
    // The service key a bearer request acts through, `{ userId, name }`, while `actor` is the user it acts as.
    via: normalizeVia(source.via),
    // Why a bearer request is refused, in words: `{ status, code, message }`.
    refusal: normalizeRefusal(source.refusal)
  };
}

const REFUSAL_STATUSES = Object.freeze([400, 401, 403]);

function normalizeVia(value) {
  const source = asObject(value);
  const userId = textOr(source.userId);
  return userId ? Object.freeze({ userId, name: textOr(source.name) }) : null;
}

function normalizeRefusal(value) {
  const source = asObject(value);
  const message = textOr(source.message);
  if (!message) return null;
  return Object.freeze({
    status: REFUSAL_STATUSES.includes(source.status) ? source.status : 401,
    code: textOr(source.code) || "auth.session.required",
    message
  });
}

export { assertAuthPolicyDeps, normalizeActorResolution };
