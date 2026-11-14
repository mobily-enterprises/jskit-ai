// The types of local auth's capabilities, for packages that provide one, and
// the types its modules share.

/**
 * One transaction of a local auth backend. A find answers null when nothing
 * matches; a bulk change answers how many records it changed. A recovery
 * token's kind is the start of its id (a password reset's is `rec_`), and
 * `consumeForUser` consumes the user's unused tokens of the kind its idPrefix
 * names, never their others.
 * @typedef {object} AuthLocalBackendTransaction
 * @property {{
 *   create(input: object): Promise<object>,
 *   findById(userId: string): Promise<object | null>,
 *   findByEmail(email: string): Promise<object | null>,
 *   hasAny(): Promise<boolean>,
 *   updatePassword(userId: string, passwordRecord: object): Promise<object | null>,
 *   updateProfile(userId: string, updates: object): Promise<object | null>,
 *   updatePendingEmail(userId: string, pendingEmail: string): Promise<object | null>,
 *   updateEmail(userId: string, email: string): Promise<object | null>
 * }} users `hasAny` answers whether any account exists. A user whose `disabled` is true has every sign-in and session
 *   refused, and a sign-in that proves who it is (the right password, a provider or a pass) is told its
 *   `disabledMessage`, or that the account is disabled when it has none; the file backend keeps no message. A user's
 *   `pendingEmail` is the address its email change waits to confirm ("" when none): `updatePendingEmail` sets it, and
 *   `updateEmail` changes the email to a confirmed address and clears it, refusing an email another account has with
 *   a ConflictError.
 * @property {{
 *   create(input: object): Promise<object>,
 *   findById(sessionId: string): Promise<object | null>,
 *   findByTokenHash(tokenHash: string): Promise<object | null>,
 *   revoke(sessionId: string): Promise<object | null>,
 *   revokeForUser(userId: string, options?: object): Promise<number>,
 *   markSecondFactorProved(sessionId: string, secondFactorAt: string): Promise<object | null>,
 *   clearSecondFactorForUser(userId: string): Promise<number>,
 *   touch(sessionId: string, seen: { lastSeenAt: string, ip: string, userAgent: string }): Promise<void>
 * }} sessions A session's `secondFactorAt` is when it last proved its second factor ("" when it has not):
 *   `markSecondFactorProved` marks one session, `clearSecondFactorForUser` every session of the user. A session keeps
 *   where it was last seen from, `ip` and `userAgent` (`create` takes them with `lastSeenAt`), and when, `lastSeenAt`,
 *   each "" when unknown; `touch` notes it seen again, keeping its `ip` or `userAgent` when the new one is "".
 * @property {{
 *   create(input: object): Promise<object>,
 *   findByTokenHash(tokenHash: string): Promise<object | null>,
 *   consume(tokenId: string): Promise<object | null>, the consumed token, or null when it is missing or already used
 *   consumeForUser(userId: string, options: { idPrefix: string }): Promise<number>
 * }} recovery
 * @property {{
 *   create(input: object): Promise<object>,
 *   findByProviderSubject(provider: string, providerSubject: string): Promise<object | null>,
 *   listForUser(userId: string): Promise<object[]>,
 *   deleteForUser(userId: string, provider: string): Promise<number>
 * }} identities
 * @property {{
 *   create(input: object): Promise<object>,
 *   take(browserKeyHash: string): Promise<object | null>,
 *   deleteExpired(now: string): Promise<number>
 * }} oauthAttempts
 * @property {{
 *   find(email: string): Promise<AuthLocalSignInFailures | null>,
 *   save(record: AuthLocalSignInFailures): Promise<AuthLocalSignInFailures>,
 *   clear(email: string): Promise<number>,
 *   deleteBefore(lastFailedAt: string): Promise<number>
 * }} signInFailures One record per account email, existing or not; `find` holds the email's record until the
 *   transaction ends, so concurrent failures count one after another, `save` replaces the email's record and
 *   `deleteBefore` removes those whose last failure is older.
 * @property {{
 *   find(userId: string): Promise<AuthLocalSecondFactor | null>,
 *   findMany(userIds: string[]): Promise<AuthLocalSecondFactor[]>,
 *   save(record: AuthLocalSecondFactor): Promise<AuthLocalSecondFactor>,
 *   delete(userId: string): Promise<number>
 * }} secondFactors One second factor per account; `find` holds the account's record until the transaction ends, so
 *   concurrent codes are checked one after another, `findMany` reads without holding, and `save` replaces the
 *   account's record.
 * @property {{
 *   save(record: AuthLocalRegistration): Promise<AuthLocalRegistration>,
 *   findByEmail(email: string): Promise<AuthLocalRegistration | null>,
 *   findByTokenHash(tokenHash: string): Promise<AuthLocalRegistration | null>,
 *   delete(email: string): Promise<number>,
 *   deleteExpired(now: string): Promise<number>
 * }} registrations Registrations waiting for their email to be confirmed, one per
 *   email; `save` replaces the email's registration. Saved only while
 *   AUTH_LOCAL_EMAIL_CONFIRMATION is on; a sign-in reads them whatever it says.
 * @property {{
 *   use(input: { id: string, expiresAt: string }): Promise<boolean>,
 *   deleteExpired(now: string): Promise<number>
 * }} passes The one-time passes already used, by the hash of each pass's id: `use` records one and answers true, or
 *   answers false when it was recorded before, also when another server recorded it at the same moment; a record is
 *   kept until `expiresAt` (its pass's `usableUntil`), and `deleteExpired` removes those whose time has come.
 */

/**
 * The `auth.local.pass-identity` capability: the application's mapping from a verified one-time pass
 * (`@jskit-ai/auth-pass/server`) to the local account it signs in, by the account's id, or null when the
 * pass's subject has none, which refuses the pass as unmapped. Required while AUTH_PASS_PUBLIC_KEY is set.
 * @typedef {(pass: import("@jskit-ai/auth-pass/server").AuthPass) => Promise<string | null>} AuthLocalPassIdentity
 */

/**
 * A registration waiting for its email to be confirmed: the account it will
 * create, the hash of its confirmation link's code, and when that link
 * expires. Times are ISO strings.
 * @typedef {object} AuthLocalRegistration
 * @property {string} email
 * @property {string} displayName
 * @property {object} password The stored password record, as users keep it.
 * @property {{ token: string, source: string } | null} invitation The invitation it registered with.
 * @property {string} tokenHash
 * @property {string} createdAt
 * @property {string} expiresAt
 */

/**
 * An account's second factor: its authenticator secret sealed with the
 * application's key, when the first code confirmed it ("" while it is being
 * set up), the 30-second step of the last code accepted (no code of that step
 * or an earlier one is accepted again), the keyed hashes of its unused recovery
 * codes, and its wrong codes as failed sign-ins count them. Times are ISO
 * strings.
 * @typedef {object} AuthLocalSecondFactor
 * @property {string} userId
 * @property {string} secretSealed
 * @property {string} confirmedAt
 * @property {number} lastUsedStep
 * @property {string[]} recoveryCodes
 * @property {number} failures
 * @property {string} lastFailedAt
 * @property {string} lockedUntil
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One second factor event: an authenticator setup started or confirmed, a
 * session's second factor verified (by a `code` or a `recoveryCode`, with the
 * recovery codes left), a failed attempt (`reason`: codeInvalid, codeUsed,
 * recoveryCodeInvalid or locked), the recovery codes replaced, the
 * authenticator removed by its person, or reset by the application for the
 * account `byUserId` names. `userId` is the local account's id, `ip` the
 * request's address ("" for a reset), `at` an ISO time.
 * @typedef {object} AuthLocalSecondFactorEvent
 * @property {"setupStarted" | "setupConfirmed" | "verified" | "failed" | "recoveryCodesReplaced" | "removed" | "reset"} type
 * @property {string} userId
 * @property {string} ip
 * @property {string} at
 * @property {"code" | "recoveryCode"} [method]
 * @property {number} [recoveryCodesLeft]
 * @property {"codeInvalid" | "codeUsed" | "recoveryCodeInvalid" | "locked"} [reason]
 * @property {string} [byUserId]
 */

/**
 * The `auth.local.second-factor-events` capability: records each second
 * factor event, for an application's audit log. It runs after the change is
 * stored; when it fails, local auth logs the failure and the operation still
 * answers. Without one, local auth logs each event.
 * @typedef {(event: AuthLocalSecondFactorEvent) => Promise<void>} AuthLocalSecondFactorEvents
 */

/**
 * One sign-in event: a sign-in (`signedIn`) or a refused one (`failed`), by
 * `method`: `password`, `registration` (registering signed in at once),
 * `confirmation` (a registration's email link), `recovery` (a password reset's
 * link), `pass` (a one-time pass) or `provider` (with `provider`, its id, such
 * as `google`). A refusal's `reason` is `invalidCredentials`, `locked` (the
 * email waits after its failures; the password was not checked),
 * `unconfirmed` (the right password of a registration still waiting for its
 * link) or `disabled` (the right password, provider or pass of a disabled
 * account). `userId` is the local account's id, "" when the email names none;
 * `email` is the email signed in, or typed; `ip` and `userAgent` are the
 * request's, "" when there is no request; `at` is an ISO time. No secret,
 * password or token is in it.
 * @typedef {object} AuthLocalSignInEvent
 * @property {"signedIn" | "failed"} type
 * @property {"password" | "registration" | "confirmation" | "recovery" | "pass" | "provider"} method
 * @property {string} userId
 * @property {string} email
 * @property {string} ip
 * @property {string} userAgent
 * @property {string} at
 * @property {"invalidCredentials" | "locked" | "unconfirmed" | "disabled"} [reason]
 * @property {string} [provider]
 */

/**
 * The `auth.local.sign-in-events` capability: records each sign-in and each
 * refused one, for an application's own list of an account's sign-ins or its
 * audit log. It is given each event after the request has answered, so a
 * refused sign-in takes the same time whatever it does; when it fails, local
 * auth logs the failure. A stopping server waits for it, for a while. Without
 * one, local auth logs each event.
 * @typedef {(event: AuthLocalSignInEvent) => Promise<void>} AuthLocalSignInEvents
 */

/**
 * An account's recent failed sign-ins: how many, the last one, and when it may
 * try again ("" when it need not wait). Times are ISO strings.
 * @typedef {{ email: string, failures: number, lastFailedAt: string, lockedUntil: string }} AuthLocalSignInFailures
 */

/**
 * The `auth.local.backend` capability: where local auth keeps its users,
 * sessions, recovery tokens, linked identities, OAuth attempts, failed
 * sign-ins, unconfirmed registrations, second factors and used one-time passes. Without
 * one, local auth keeps them in files under AUTH_LOCAL_STORE_DIR;
 * `@jskit-ai/auth-provider-local-db-core` provides one that keeps them in the
 * database. Each backend implements this contract.
 * @typedef {object} AuthLocalBackend
 * @property {<T>(callback: (tx: AuthLocalBackendTransaction) => Promise<T>) => Promise<T>} withTransaction
 *   Runs the callback in one transaction and answers what it answered.
 */

/**
 * The `auth.local.password-strategy` capability: how local auth hashes and
 * checks passwords. A strategy may give only one of the two operations; local
 * auth uses scrypt for the other.
 * @typedef {object} AuthLocalPasswordStrategy
 * @property {(password: string) => Promise<unknown>} [hashPassword] Answers the record to store.
 * @property {(password: string, record: unknown) => Promise<boolean> | boolean} [verifyPassword]
 *   Answers true when the password matches the stored record.
 */

/**
 * The `auth.local.recovery-sender` capability: sends a password recovery link
 * to the person it belongs to. Local auth calls it as APP_ENV says: in
 * production with that person's address; in staging with STAGING_EMAIL_TO's,
 * and `originalEmail` the person's, which the email should show (for example
 * with `markStagingEmail` from `@jskit-ai/kernel/server/runtime/appEnvironment`);
 * never in development or test, which log the link. `originalEmail` is ""
 * when the email goes to its own address.
 * @typedef {(delivery: { email: string, originalEmail?: string, recoveryUrl: string }) => Promise<void>} AuthLocalRecoverySender
 */

/**
 * The `auth.local.confirmation-sender` capability: sends a new registration's
 * email confirmation link to the address it registered, as APP_ENV says, like
 * `AuthLocalRecoverySender`.
 * @typedef {(delivery: { email: string, originalEmail?: string, confirmationUrl: string }) => Promise<void>} AuthLocalConfirmationSender
 */

/**
 * The `auth.local.email-change-sender` capability: sends what an account's
 * email change sends, each through the application's email. `confirmation`
 * goes to the new address (`email`) with the link that confirms it
 * (`confirmationUrl`), naming the account's current address
 * (`currentEmail`); `notice` goes to the old address (`email`) once the email
 * changed, naming the new one (`newEmail`). It sends as APP_ENV says, like
 * `AuthLocalRecoverySender`. It must reject on failure, which local auth logs,
 * and must not log the link. Without one, a staging or production server has
 * no email change; development and test log each.
 * @typedef {(delivery: { type: "confirmation", email: string, originalEmail?: string, currentEmail: string, confirmationUrl: string }
 *   | { type: "notice", email: string, originalEmail?: string, newEmail: string }) => Promise<void>} AuthLocalEmailChangeSender
 */

/**
 * The `auth.local.confirmation-mode` capability: the application's choice, for
 * one registration that would wait for its email to be confirmed, of how it is
 * confirmed. "link" sends the confirmation link, as without one; "without-link"
 * creates the account and signs the person in at once, with an address nobody
 * proved, for example while the application's email isn't set up. Any other
 * answer means "link". It sends nothing, so it applies in every environment
 * (APP_ENV), whatever happens to the confirmation sender's emails.
 * @typedef {(registration: { email: string }) => Promise<"link" | "without-link">} AuthLocalConfirmationMode
 */

/** @typedef {ReturnType<typeof import("./lib/config.js").resolveLocalAuthConfig>} AuthLocalConfig */
/** @typedef {ReturnType<typeof import("./lib/deliveries.js").createLocalDeliveries>} AuthLocalDeliveries */
/** @typedef {AuthLocalConfig["oauthProviders"][number]} AuthLocalOAuthProvider */
/** @typedef {ReturnType<typeof import("./lib/firstAccountSetup.js").createFirstAccountSetup>} AuthLocalFirstAccountSetup */
/** @typedef {ReturnType<typeof import("./lib/passwords.js").normalizePasswordStrategy>} AuthLocalPasswords */
/** @typedef {ReturnType<typeof import("./lib/sessions.js").createLocalSessions>} AuthLocalSessions */

export {};
