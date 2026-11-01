// The types of the auth capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./authAccess.js").createAuthAccess>} AuthAccess */
/** @typedef {ReturnType<typeof import("./authExtensions.js").createAuthExtensions>} AuthExtensions */
/** @typedef {ReturnType<typeof import("./authPolicy.js").createAuthPolicy>} AuthPolicy */

/** @typedef {ReturnType<typeof import("../shared/authCapabilities.js").normalizeAuthCapabilities>} AuthCapabilities */
/** @typedef {NonNullable<ReturnType<typeof import("./authActor.js").normalizeAuthActor>>} AuthActor */

/**
 * What authenticateRequest() answers for a request.
 * @typedef {object} AuthRequestResult
 * @property {boolean} authenticated
 * @property {AuthActor} [actor] The signed-in actor, when authenticated.
 * @property {object | null} [session] The session to write with writeSessionCookies(), or null.
 * @property {boolean} [clearSession] True when the request's session cookies should be cleared.
 * @property {boolean} [transientFailure] True when authentication could not be decided at this time.
 * @property {boolean} [refreshRequired] True when the session must be refreshed first, which a caller
 *   that asked for no refresh (`refreshSession: false`), such as a realtime socket, cannot do.
 */

/**
 * The `auth.profile.projector` capability: the application's profiles of the
 * identities that sign in. An auth provider without one uses noAppProfiles
 * (`@jskit-ai/auth-core/server/noAppProfiles`), which keeps none.
 * @typedef {object} AuthProfileProjector
 * @property {(profile: object, options?: object) => Promise<object | null>} syncIdentityProfile
 *   Creates or updates the application's profile of a signed-in identity and answers it,
 *   or null when the application keeps no profiles.
 * @property {(identity: object, options?: object) => Promise<object | null>} findByIdentity
 *   Answers the existing profile without synchronizing it, or null when there is none.
 */

/**
 * The invitation context resolver an application registers on
 * `auth.extensions`; an auth provider reads it once with
 * resolveInvitationContextResolver(), which answers invitationAsGiven when none
 * is registered.
 * @typedef {object} AuthInvitationContextResolver
 * @property {string} resolverId
 * @property {(invitation: { token: string, source: string, email: string }) => Promise<object>} resolveInvitationContext
 */

/**
 * What a realtime server asks of the auth service, when it asks anything.
 * @typedef {object} AuthRealtimePolicy
 * @property {boolean} [requireAuthentication] Refuses sockets that are not signed in.
 * @property {(input: { actor: AuthActor | null, event: { name: string, payload: any } }) => boolean | Promise<boolean>} [authorizeEvent]
 *   Answers true when the actor may receive the event.
 */

/**
 * What logout() answers: the provider signed the session out, and whether the
 * caller should clear the request's session cookies.
 * @typedef {object} AuthLogoutResult
 * @property {boolean} ok
 * @property {boolean} clearSession
 */

/**
 * The `auth.service` capability: the installed auth provider's operations,
 * after every auth service decorator. Every provider implements every
 * operation without brackets. The ones named in AUTH_OPERATION_FEATURES
 * (`@jskit-ai/auth-core/shared/authCapabilities`) depend on a feature of
 * getCapabilities(): when the feature is off, the operation throws
 * AUTH_OPERATION_UNSUPPORTED. An optional operation (in brackets) is one some
 * provider lacks.
 * @typedef {object} AuthService
 * @property {() => AuthCapabilities} getCapabilities
 * @property {(request: object, options?: { syncProfile?: boolean, refreshSession?: boolean }) => Promise<AuthRequestResult>} authenticateRequest
 * @property {(request: object) => boolean} hasAccessTokenCookie
 * @property {(request: object) => boolean} hasSessionCookie
 * @property {(reply: object, session: object) => void} writeSessionCookies
 * @property {(reply: object) => void} clearSessionCookies
 * @property {(request: object) => Promise<AuthLogoutResult>} logout
 * @property {() => boolean} isDevAuthBootstrapEnabled
 * @property {(input: object) => Promise<object>} register
 * @property {(input: object) => Promise<object>} resendRegisterConfirmation
 * @property {(input: object) => Promise<object>} login
 * @property {(input: object) => Promise<object>} requestOtpLogin
 * @property {(input: object) => Promise<object>} verifyOtpLogin
 * @property {(input: object, request: object | null) => Promise<object>} oauthStart
 * @property {(input: object, request: object | null) => Promise<object>} oauthComplete
 * @property {(input: object) => Promise<object>} requestPasswordReset
 * @property {(input: object) => Promise<object>} completePasswordRecovery
 * @property {(input: object, request: object | null) => Promise<object>} resetPassword
 * @property {(request: object, input: object) => Promise<object>} changePassword
 * @property {(request: object, input: object) => Promise<object>} updateDisplayName
 * @property {(request: object) => Promise<object>} getSecurityStatus
 * @property {(request: object, input: object) => Promise<object>} setPasswordSignInEnabled
 * @property {(request: object, input: object) => Promise<object>} startProviderLink
 * @property {(request: object, input: object) => Promise<object>} unlinkProvider
 * @property {(request: object) => Promise<object>} signOutOtherSessions
 * @property {(input: object, request: object | null) => Promise<object>} devLoginAs
 * @property {(reply: object, result: object) => void} [writeOAuthStartCookies] Keeps the state of an OAuth sign-in that oauthStart() began.
 * @property {(reply: object) => void} [clearOAuthStartCookies]
 * @property {(request: object, options?: { everywhere?: boolean }) => Promise<any>} [logoutEverywhere]
 * @property {() => object} [getSettingsProfileAuthInfo] What the account settings show about the provider's profile.
 * @property {() => object} [getOAuthProviderCatalog] The OAuth providers the sign-in screen offers.
 * @property {AuthRealtimePolicy} [realtime]
 */

export {};
