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
 * @property {string} [secondFactorAt] When the request's session last proved its second factor, as ISO text, or ""
 *   when it has not; the auth policy compares it with a route's `secondFactor`.
 * @property {boolean} [refreshRequired] True when the session must be refreshed first, which a caller
 *   that asked for no refresh (`refreshSession: false`), such as a realtime socket, cannot do.
 */

/**
 * The `auth.profile.projector` capability: the application's profiles of the
 * identities that sign in. An auth provider without one uses noAppProfiles
 * (`@jskit-ai/auth-core/server/noAppProfiles`), which keeps none.
 * @typedef {object} AuthProfileProjector
 * @property {(profile: object, options?: { onlyWhenChanged?: boolean }) => Promise<object | null>} syncIdentityProfile
 *   Creates or updates the application's profile of a signed-in identity and answers it,
 *   or null when the application keeps no profiles. Providers synchronize in full at sign-in and
 *   at each session refresh; an ordinary request passes `onlyWhenChanged`, which answers an
 *   existing profile that already matches the identity after one read and synchronizes only a
 *   missing or changed one.
 * @property {(identity: object, options?: object) => Promise<object | null>} findByIdentity
 *   Answers the existing profile without synchronizing it, or null when there is none.
 */

/**
 * The invitation context resolver an application registers on
 * `auth.extensions`; an auth provider reads it once with
 * resolveInvitationContextResolver(), which answers invitationAsGiven when none
 * is registered. It throws for an invitation the registration cannot use
 * (unknown, no longer pending, or sent to another email), and the context it
 * answers becomes the provider's profile options' `invitation`. The context's
 * `email`, when given, is the address the invitation was sent to, and its
 * `expiresAt` when the invitation stops working: local auth registers a person
 * whose email the invitation names, before then, without confirming the email.
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
 * A proof of the second factor: an authenticator's current code, or one of
 * the recovery codes; exactly one of the two.
 * @typedef {{ code?: string, recoveryCode?: string }} AuthSecondFactorProof
 */

/**
 * The signed-in person's second factor: whether an authenticator is set up and
 * since when, how many recovery codes are left, and when the request's session
 * last proved it (null when it has not).
 * @typedef {object} AuthSecondFactorStatus
 * @property {boolean} enrolled
 * @property {string | null} enrolledAt
 * @property {number} recoveryCodesLeft
 * @property {string | null} verifiedAt
 */

/**
 * A proof the provider accepted: when, by which kind of code, and how many
 * recovery codes are left.
 * @typedef {object} AuthSecondFactorVerification
 * @property {string} verifiedAt
 * @property {"code" | "recoveryCode"} method
 * @property {number} recoveryCodesLeft
 */

/**
 * New recovery codes, shown once, and when the session proved its second
 * factor to get them.
 * @typedef {{ recoveryCodes: string[], verifiedAt: string }} AuthSecondFactorRecoveryCodes
 */

/**
 * A started authenticator setup: its secret in base32, shown once, and the
 * otpauth:// address an authenticator app reads from a QR code.
 * @typedef {object} AuthSecondFactorSetup
 * @property {string} secret
 * @property {string} otpauthUrl
 * @property {string} issuer
 * @property {string} accountName
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
 * @property {(input: { token: string, password: string }) => Promise<object>} confirmRegistration Creates the account a
 *   registration waited to create until its email was confirmed, from its link's code and the password it registered
 *   with, and signs the person in.
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
 * @property {(request: object) => Promise<AuthSecondFactorStatus>} getSecondFactorStatus
 * @property {(request: object) => Promise<AuthSecondFactorSetup>} startSecondFactorSetup Starts setting up an
 *   authenticator for the signed-in person, replacing a setup they have not confirmed.
 * @property {(request: object, input: { code: string }) => Promise<AuthSecondFactorRecoveryCodes>} confirmSecondFactorSetup
 *   Confirms the setup with a first code, answers its recovery codes once, and marks the request's session as having
 *   proved its second factor.
 * @property {(request: object, input: AuthSecondFactorProof) => Promise<AuthSecondFactorVerification>} verifySecondFactor
 *   Marks the request's session as having proved its second factor.
 * @property {(request: object, input: AuthSecondFactorProof) => Promise<AuthSecondFactorRecoveryCodes>}
 *   replaceSecondFactorRecoveryCodes
 * @property {(request: object, input: AuthSecondFactorProof) => Promise<{ ok: true }>} removeSecondFactor
 * @property {(input: { userIds: string[] }) => Promise<{ userId: string, enrolledAt: string }[]>} listSecondFactors
 *   The given accounts (provider user ids) that have an authenticator set up: for an application's own screens.
 * @property {(input: { userId: string, byUserId: string }) => Promise<{ reset: boolean }>} resetSecondFactor
 *   Removes an account's authenticator and recovery codes for the application, which decides who may: for an owner
 *   whose staff lost their authenticator. `byUserId` names who reset it, for the audit event.
 * @property {(reply: object, result: object) => void} [writeOAuthStartCookies] Keeps the state of an OAuth sign-in that oauthStart() began.
 * @property {(reply: object) => void} [clearOAuthStartCookies]
 * @property {(input: { pass: string }) => Promise<object>} [signInWithPass] Signs in the account a one-time signed pass
 *   names (`@jskit-ai/auth-core/server/passSignIn`), once per pass; local auth has it, with AUTH_PASS_PUBLIC_KEY set.
 * @property {(request: object, options?: { everywhere?: boolean }) => Promise<any>} [logoutEverywhere]
 * @property {() => object} [getSettingsProfileAuthInfo] What the account settings show about the provider's profile.
 * @property {() => object} [getOAuthProviderCatalog] The OAuth providers the sign-in screen offers.
 * @property {AuthRealtimePolicy} [realtime]
 */

export {};
