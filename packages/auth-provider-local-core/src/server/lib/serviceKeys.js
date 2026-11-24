import { createId, isExpiredIso, randomToken, sha256Base64url, verifySignedToken } from "./tokens.js";

// A service key lets another application's server (an assistant such as Mercbot) call this app's bearer routes
// (credentials: "bearer") as the users it names: each call names exactly one (Act-As-User: a user id, or an email that
// exactly one enabled account has) and runs with that user's own rights, never with the key's. A key is one row of the
// sessions store, purpose "service-key", of a dedicated service user whose display name names it; an administrator
// makes it (createServiceKeyRecord, written with the backend's sessions.create) and ends it by revoking that row or
// disabling the service user. It never signs in a browser: cookie authentication takes only normal and development
// sessions.

const SERVICE_KEY_PURPOSE = "service-key";
const ACT_AS_USER_HEADER = "act-as-user";
const DEFAULT_LIFETIME_DAYS = 365;
const MAX_LIFETIME_DAYS = 3650;
const DAY_MS = 86_400_000;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/u;
// The most of a caller's Act-As-User a refusal repeats back.
const ECHO_MAX_LENGTH = 320;

const REFUSALS = Object.freeze({
  required: [401, "auth.serviceKey.required",
    () => "This route takes a service key: send Authorization: Bearer <key> and Act-As-User: <user id or email>."],
  invalid: [401, "auth.serviceKey.invalid",
    () => "The service key is unknown, revoked or expired, or its service user is disabled."],
  notServiceKey: [403, "auth.serviceKey.notServiceKey",
    () => "Only a service key may act as other users; a person's own sign-in may not."],
  actAsRequired: [400, "auth.serviceKey.actAsRequired",
    () => "Name the user this call acts as in Act-As-User (a user id or email): a service key never acts as itself."],
  actAsUnknown: [403, "auth.serviceKey.actAsUnknown", (who) => `There is no user ${who} to act as.`],
  actAsInactive: [403, "auth.serviceKey.actAsInactive", (who) => `User ${who} is disabled, so nothing may act as them.`],
  actAsAmbiguous: [403, "auth.serviceKey.actAsAmbiguous",
    (who) => `More than one user has the email ${who}, so it names no one: pick yours and act as it by its id.`],
  actAsSelf: [403, "auth.serviceKey.actAsSelf", () => "A service key acts as other users, never as its own service user."]
});

/**
 * A new service key for a service user, and the sessions-store row that holds its hash: the caller writes the row in
 * its backend's transaction (`tx.sessions.create(record)`) and shows the key once; it cannot be read back.
 * @param {{ userId: string, now?: number, days?: number }} options `days` is the key's lifetime, 1 to 3650 (365).
 */
function createServiceKeyRecord({ userId, now = Date.now(), days = DEFAULT_LIFETIME_DAYS } = /** @type {any} */ ({})) {
  if (!String(userId ?? "").trim()) throw new TypeError("createServiceKeyRecord needs the userId of the key's service user.");
  if (!Number.isInteger(days) || days < 1 || days > MAX_LIFETIME_DAYS) {
    throw new TypeError(`createServiceKeyRecord days is a key's lifetime in whole days, 1 to ${MAX_LIFETIME_DAYS}.`);
  }
  const key = `svk_${randomToken(32)}`;
  return Object.freeze({
    key,
    record: Object.freeze({
      id: createId("svk"),
      userId: String(userId).trim(),
      tokenHash: sha256Base64url(key),
      purpose: SERVICE_KEY_PURPOSE,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * DAY_MS).toISOString()
    })
  });
}

/** A bearer route's refusal in words, which auth-core answers with its status and code. */
function serviceKeyRefusal(reason, actAs = "") {
  const [status, code, message] = REFUSALS[reason];
  return Object.freeze({
    authenticated: false,
    session: null,
    clearSession: false,
    transientFailure: false,
    refusal: Object.freeze({ status, code, message: message(JSON.stringify(actAs.slice(0, ECHO_MAX_LENGTH))) })
  });
}

/**
 * The user an email names: the one enabled account with it, else a disabled one (which is refused as disabled), else
 * none; more than one enabled account with it names no one.
 * @param {import("../types.js").AuthLocalBackendTransaction["users"]} users
 * @param {string} email
 */
async function userByEmail(users, email) {
  // readable-check: allow method-probe - input validation: a backend from before findAllByEmail fails naming its fix
  if (typeof users.findAllByEmail !== "function") {
    throw new TypeError("A service key acts as a user by email through the backend's users.findAllByEmail(email), every account with that email: add it to the local auth backend.");
  }
  const matches = await users.findAllByEmail(email);
  const enabled = matches.filter((match) => !match.disabled);
  if (enabled.length > 1) return { ambiguous: true, user: null };
  return { ambiguous: false, user: enabled[0] || matches[0] || null };
}

/**
 * Who a bearer request acts as: its service key, checked, and the active user its Act-As-User names; or the reason it
 * is refused. One read of the key and two of users, in one transaction.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {string} dependencies.sessionSecret What a person's own access tokens are signed with.
 * @param {{ headers?: Record<string, unknown> }} request
 * @returns {Promise<{ refusal: string, actAs?: string } | { key: object, keyUser: object, user: object }>}
 */
async function resolveServiceKeyCall({ backend, sessionSecret }, request) {
  const authorization = String(request?.headers?.authorization || "").trim();
  if (!authorization) return { refusal: "required" };
  const token = BEARER_PATTERN.exec(authorization)?.[1] || "";
  if (!token) return { refusal: "invalid" };
  // A person's own access token is signed: it is theirs alone, never a key.
  if (verifySignedToken(token, sessionSecret)) return { refusal: "notServiceKey" };
  const actAs = String(request.headers[ACT_AS_USER_HEADER] || "").trim();
  return backend.withTransaction(async (tx) => {
    const key = await tx.sessions.findByTokenHash(sha256Base64url(token));
    if (!key || key.revokedAt || isExpiredIso(key.expiresAt)) return { refusal: "invalid" };
    if (key.purpose !== SERVICE_KEY_PURPOSE) return { refusal: "notServiceKey" };
    const keyUser = await tx.users.findById(String(key.userId));
    if (!keyUser || keyUser.disabled) return { refusal: "invalid" };
    if (!actAs) return { refusal: "actAsRequired" };
    const found = actAs.includes("@") ? await userByEmail(tx.users, actAs.toLowerCase()) : { user: await tx.users.findById(actAs) };
    if (found.ambiguous) return { refusal: "actAsAmbiguous", actAs };
    const { user } = found;
    if (!user) return { refusal: "actAsUnknown", actAs };
    if (String(user.id) === String(keyUser.id)) return { refusal: "actAsSelf", actAs };
    if (user.disabled) return { refusal: "actAsInactive", actAs };
    return { key, keyUser, user };
  });
}

export { ACT_AS_USER_HEADER, SERVICE_KEY_PURPOSE, createServiceKeyRecord, resolveServiceKeyCall, serviceKeyRefusal };
