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
 *   updatePassword(userId: string, passwordRecord: object): Promise<object | null>,
 *   updateProfile(userId: string, updates: object): Promise<object | null>
 * }} users
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
 */

/**
 * The `auth.local.backend` capability: where local auth keeps its users,
 * sessions, recovery tokens, linked identities and OAuth attempts. Without
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

/** @typedef {ReturnType<typeof import("./lib/config.js").resolveLocalAuthConfig>} AuthLocalConfig */
/** @typedef {AuthLocalConfig["oauthProviders"][number]} AuthLocalOAuthProvider */
/** @typedef {ReturnType<typeof import("./lib/passwords.js").normalizePasswordStrategy>} AuthLocalPasswords */
/** @typedef {ReturnType<typeof import("./lib/sessions.js").createLocalSessions>} AuthLocalSessions */

export {};
