// The types of local auth's capabilities, for packages that provide one, and
// the types its modules share.

/**
 * One transaction of a local auth backend. A find answers null when nothing
 * matches; a bulk change answers how many records it changed.
 * @typedef {object} AuthLocalBackendTransaction
 * @property {{
 *   create(input: object): Promise<object>,
 *   findById(userId: string): Promise<object | null>,
 *   findByEmail(email: string): Promise<object | null>,
 *   hasAny(): Promise<boolean>,
 *   updatePassword(userId: string, passwordRecord: object): Promise<object | null>,
 *   updateProfile(userId: string, updates: object): Promise<object | null>
 * }} users `hasAny` answers whether any account exists.
 * @property {{
 *   create(input: object): Promise<object>,
 *   findById(sessionId: string): Promise<object | null>,
 *   findByTokenHash(tokenHash: string): Promise<object | null>,
 *   revoke(sessionId: string): Promise<object | null>,
 *   revokeForUser(userId: string, options?: object): Promise<number>
 * }} sessions
 * @property {{
 *   create(input: object): Promise<object>,
 *   findByTokenHash(tokenHash: string): Promise<object | null>,
 *   consume(tokenId: string): Promise<object | null>,
 *   consumeForUser(userId: string): Promise<number>
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
 * }} signInFailures One record per account email, existing or not; `save`
 *   replaces the email's record and `deleteBefore` removes those whose last failure is older.
 * @property {{
 *   save(record: AuthLocalRegistration): Promise<AuthLocalRegistration>,
 *   findByEmail(email: string): Promise<AuthLocalRegistration | null>,
 *   findByTokenHash(tokenHash: string): Promise<AuthLocalRegistration | null>,
 *   delete(email: string): Promise<number>,
 *   deleteExpired(now: string): Promise<number>
 * }} registrations Registrations waiting for their email to be confirmed, one per
 *   email; `save` replaces the email's registration. Used only while
 *   AUTH_LOCAL_EMAIL_CONFIRMATION is on.
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
 * An account's recent failed sign-ins: how many, the last one, and when it may
 * try again ("" when it need not wait). Times are ISO strings.
 * @typedef {{ email: string, failures: number, lastFailedAt: string, lockedUntil: string }} AuthLocalSignInFailures
 */

/**
 * The `auth.local.backend` capability: where local auth keeps its users,
 * sessions, recovery tokens, linked identities, OAuth attempts, failed
 * sign-ins and unconfirmed registrations. Without
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
 * to the person it belongs to.
 * @typedef {(delivery: { email: string, recoveryUrl: string }) => Promise<void>} AuthLocalRecoverySender
 */

/**
 * The `auth.local.confirmation-sender` capability: sends a new registration's
 * email confirmation link to the address it registered.
 * @typedef {(delivery: { email: string, confirmationUrl: string }) => Promise<void>} AuthLocalConfirmationSender
 */

/** @typedef {ReturnType<typeof import("./lib/config.js").resolveLocalAuthConfig>} AuthLocalConfig */
/** @typedef {AuthLocalConfig["oauthProviders"][number]} AuthLocalOAuthProvider */
/** @typedef {ReturnType<typeof import("./lib/firstAccountSetup.js").createFirstAccountSetup>} AuthLocalFirstAccountSetup */
/** @typedef {ReturnType<typeof import("./lib/passwords.js").normalizePasswordStrategy>} AuthLocalPasswords */
/** @typedef {ReturnType<typeof import("./lib/sessions.js").createLocalSessions>} AuthLocalSessions */

export {};
