import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// Local sign-in's tables, each owned by the database backend feature. The rows are sign-in state read before anyone
// is known (an account by email, a session or recovery token by its hash), so every table is public: no workspace or
// user owns a row, and only the owner feature's code reads or writes them. Text is kept exactly as written (noTrim),
// and every timestamp is written as a UTC database date-time.

const text = Object.freeze({ type: "string", noTrim: true });
const searchableText = Object.freeze({ ...text, search: true });
const dateTime = Object.freeze({ type: "dateTime", storage: Object.freeze({ writeSerializer: "datetime-utc" }) });
const optionalDateTime = Object.freeze({ ...dateTime, nullable: true });
const password = Object.freeze({
  passwordAlgorithm: text,
  passwordVersion: text,
  passwordSalt: text,
  passwordHash: text
});
// Rows that expire by a time, inclusive.
const expiresAtOrBefore = Object.freeze({ type: "dateTime", actualField: "expiresAt", filterOperator: "<=" });

// auth_local_users: one row per local account, keyed by its text id.
const localAuthUserResource = defineTableResource({
  name: "localAuthUsers",
  tableName: "auth_local_users",
  ownership: "public",
  schema: {
    email: searchableText,
    displayName: text,
    ...password,
    disabled: { type: "boolean" },
    createdAt: dateTime,
    updatedAt: dateTime,
    emailVerifiedAt: optionalDateTime
  }
});

// auth_local_sessions: a signed-in browser's session, found by the hash of its token.
const localAuthSessionResource = defineTableResource({
  name: "localAuthSessions",
  tableName: "auth_local_sessions",
  ownership: "public",
  schema: {
    userId: searchableText,
    tokenHash: searchableText,
    purpose: text,
    expiresAt: dateTime,
    revokedAt: optionalDateTime,
    createdAt: dateTime,
    updatedAt: dateTime
  },
  searchSchema: {
    // Every session of a user but one.
    exceptId: { type: "string", actualField: "id", filterOperator: "!=" },
    expiresAtOrBefore
  }
});

// auth_local_recovery: a password recovery token, found by its hash and used once.
const localAuthRecoveryResource = defineTableResource({
  name: "localAuthRecovery",
  tableName: "auth_local_recovery",
  ownership: "public",
  schema: {
    userId: searchableText,
    tokenHash: searchableText,
    expiresAt: dateTime,
    usedAt: optionalDateTime,
    createdAt: dateTime,
    updatedAt: dateTime
  }
});

// auth_local_oauth_attempts: one pending provider sign-in or link, keyed by the hash of the starting browser's key.
const localAuthOAuthAttemptResource = defineTableResource({
  name: "localAuthOAuthAttempts",
  tableName: "auth_local_oauth_attempts",
  idProperty: "browser_key_hash",
  ownership: "public",
  schema: {
    provider: text,
    intent: text,
    userId: { ...text, nullable: true },
    state: text,
    nonce: text,
    codeVerifier: text,
    returnTo: text,
    expiresAt: dateTime,
    createdAt: dateTime
  },
  searchSchema: {
    expiresAtOrBefore
  }
});

// auth_local_sign_in_failures: an account email's recent failed sign-ins, keyed by the email.
const localAuthSignInFailureResource = defineTableResource({
  name: "localAuthSignInFailures",
  tableName: "auth_local_sign_in_failures",
  idProperty: "email",
  ownership: "public",
  schema: {
    failures: { type: "integer" },
    lastFailedAt: dateTime,
    lockedUntil: optionalDateTime
  },
  searchSchema: {
    lastFailedBefore: { type: "dateTime", actualField: "lastFailedAt", filterOperator: "<" }
  }
});

// auth_local_registrations: a registration waiting for its email to be confirmed, keyed by the email.
const localAuthRegistrationResource = defineTableResource({
  name: "localAuthRegistrations",
  tableName: "auth_local_registrations",
  idProperty: "email",
  ownership: "public",
  schema: {
    displayName: text,
    ...password,
    invitationToken: { ...text, nullable: true },
    invitationSource: { ...text, nullable: true },
    tokenHash: searchableText,
    createdAt: dateTime,
    expiresAt: dateTime
  },
  searchSchema: {
    expiresAtOrBefore
  }
});

const LOCAL_AUTH_RESOURCES = Object.freeze([
  localAuthUserResource,
  localAuthSessionResource,
  localAuthRecoveryResource,
  localAuthOAuthAttemptResource,
  localAuthSignInFailureResource,
  localAuthRegistrationResource
]);

export {
  LOCAL_AUTH_RESOURCES,
  localAuthOAuthAttemptResource,
  localAuthRecoveryResource,
  localAuthRegistrationResource,
  localAuthSessionResource,
  localAuthSignInFailureResource,
  localAuthUserResource
};
