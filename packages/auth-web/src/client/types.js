// The values auth-web's client hands out and receives across files, for its own modules and for the packages that use
// the `client.auth` capability.

/**
 * The session as the guard runtime knows it.
 * @typedef {object} AuthGuardState
 * @property {boolean} authenticated
 * @property {string} username
 * @property {string} email
 * @property {readonly string[]} permissions
 * @property {string} oauthDefaultProvider
 * @property {readonly { id: string, label: string }[]} oauthProviders
 * @property {ReturnType<typeof import("@jskit-ai/auth-core/shared/authCapabilities").normalizeAuthCapabilities>} authCapabilities
 */

/**
 * Reads and follows the session: `createAuthGuardRuntime()`, or `NO_AUTH_GUARD_RUNTIME` in an application without auth's
 * provider.
 * @typedef {object} AuthGuardRuntime
 * @property {() => void} dispose
 * @property {(options?: { sessionPath?: string, loginRoute?: string }) => Promise<AuthGuardState>} initialize
 * @property {(options?: { sessionPath?: string }) => Promise<AuthGuardState>} refresh
 * @property {() => AuthGuardState} getState
 * @property {(listener: (state: AuthGuardState) => void) => () => void} subscribe
 */

/**
 * The part of shell-web's placement runtime the guard writes the session into.
 * @typedef {object} AuthPlacementRuntime
 * @property {() => Record<string, any>} getContext
 * @property {(patch: Record<string, any>, options?: { source?: string }) => void} setContext
 */

/**
 * The part of the application's socket the guard listens on.
 * @typedef {object} AuthRealtimeSocket
 * @property {(eventName: string, listener: () => void) => void} on
 * @property {(eventName: string, listener: () => void) => void} off
 */

/**
 * The part of the optional `client.realtime` capability auth-web uses, or `NO_AUTH_REALTIME` in an application without
 * it.
 * @typedef {object} AuthRealtime
 * @property {AuthRealtimeSocket} socket
 * @property {(prepare: () => unknown) => () => void} setBeforeReconnect Sets the step recovery runs before reconnecting; returns the function that removes it.
 */

/**
 * The part of the `client.shell` capability auth-web uses.
 * @typedef {object} AuthShell
 * @property {AuthPlacementRuntime} placement
 * @property {{ refresh: (reason: string) => unknown }} bootstrap
 */

/**
 * Opens a provider's sign-in page: in this page, in a window of its own from a framed page, or in a mobile application's
 * browser.
 * @typedef {object} AuthOAuthLaunchClient
 * @property {(request: { url: string }) => Promise<unknown>} open
 */

/**
 * The part of the optional `client.mobile` capability auth-web uses.
 * @typedef {object} AuthMobile
 * @property {AuthOAuthLaunchClient} [oauthLaunch] Present when the application signs in through its own browser.
 */

/**
 * The part of shell-web's error runtime that tells the user about a sign-in.
 * @typedef {object} AuthErrorRuntime
 * @property {(event: { source: string, message: string, severity: string, channel: string, dedupeKey: string, dedupeWindowMs: number }) => unknown} report
 */

/**
 * The request a callback completes with: `authHttpRequest()`, or the sign-in view's own.
 * @typedef {(path: string, options: { method?: string, body?: unknown }) => Promise<any>} AuthRequest
 */

/**
 * A second-factor proof: a code from the authenticator app, or one of the recovery codes.
 * @typedef {{ code: string } | { recoveryCode: string }} SecondFactorProof
 */

/**
 * The signed-in account's second factor, and when this session last proved it (ISO times, or null).
 * @typedef {object} SecondFactorStatus
 * @property {boolean} enrolled
 * @property {string | null} enrolledAt
 * @property {number} recoveryCodesLeft
 * @property {string | null} verifiedAt
 */

/**
 * An authenticator being set up: its secret in base32, shown once, and the otpauth address its QR code carries.
 * @typedef {object} SecondFactorSetup
 * @property {string} secret
 * @property {string} otpauthUrl
 * @property {string} issuer
 * @property {string} accountName
 */

/**
 * New recovery codes, shown once, and when the proof that made them was given.
 * @typedef {object} SecondFactorRecoveryCodes
 * @property {string[]} recoveryCodes
 * @property {string} verifiedAt
 */

/** @typedef {ReturnType<typeof import("./composables/secondFactor/useSecondFactorStepUp.js").useSecondFactorStepUp>} SecondFactorStepUp */

/** @typedef {ReturnType<typeof import("./composables/loginView/useLoginViewState.js").useLoginViewState>} LoginViewState */

/** @typedef {ReturnType<typeof import("./composables/loginView/useLoginViewValidation.js").useLoginViewValidation>} LoginViewValidation */

/** @typedef {ReturnType<typeof import("./runtime/authClient.js").createAuthClient>} AuthClient */

export {};
