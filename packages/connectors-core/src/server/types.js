// The type of the `connectors.core` capability, for features that require it,
// and the contracts of what an application passes createConnectionService().

/** @typedef {ReturnType<typeof import("./connectionService.js").createConnectionService>} ConnectorsCore */
/** @typedef {Parameters<typeof import("./connectionService.js").createConnectionService>[0]} ConnectionServiceOptions */
/** @typedef {ReturnType<typeof import("./credentialProtection.js").createCredentialProtection>} CredentialProtection */

/**
 * The application identity a connection belongs to: one application and one
 * user or shared subject in it.
 * @typedef {object} ConnectionOwner
 * @property {string} applicationId
 * @property {string} subjectId
 */

/**
 * What a connector asks the application's access policy to decide.
 * @typedef {object} ConnectorAuthorizationRequest
 * @property {string} integrationId
 * @property {string} operation The provider operation, or a connection step such as "connect", "status" or "disconnect".
 * @property {string} accountMode The integration's account mode: "shared", "per-user" or "assistant".
 * @property {{ action: string, decision: string }} [assistantPermission]
 *   In assistant execution, the assistant action and its configured decision ("ask" or "always").
 * @property {unknown} [input] A copy of the operation's input, for an operation that has one.
 */

/**
 * The application's access policy: the owner whose connection the request may
 * use, or null to deny it. An assistant action whose decision is "ask" also
 * needs `approved: true`.
 * @typedef {(context: any, request: ConnectorAuthorizationRequest) => Promise<(ConnectionOwner & { approved?: boolean }) | null>} ConnectorAuthorize
 */

/**
 * Resolves a binding reference such as `env:NAME` to its value. Resolvers of
 * per-user accounts also receive the authorized owner and the integration slot.
 * @typedef {(reference: string, owner?: ConnectionOwner, slot?: { integrationId: string, accountMode: string, providerId: string }) => Promise<string>} ResolveReference
 */

/**
 * A caller's request about one integration: the application context that
 * authorize() receives and the integration's id.
 * @typedef {object} IntegrationRequest
 * @property {any} context
 * @property {string} integrationId
 */

/**
 * A request that may reach the provider, which `signal` cancels.
 * @typedef {IntegrationRequest & { signal?: AbortSignal }} ProviderRequest
 */

/**
 * A request that connects an account, with the input its verification takes.
 * @typedef {ProviderRequest & { verificationInput?: Record<string, any> }} ConnectRequest
 */

/**
 * One connection's stored state, held under the store's lock while work runs.
 * @typedef {object} ConnectionRecord
 * @property {Record<string, any> | null} connection The stored connection, or null.
 * @property {(connection: object) => Promise<void>} save
 * @property {() => Promise<void>} remove Removes the connection and its authorization attempts.
 * @property {(attempt: Record<string, any> & { state: string, expiresAt: number }) => Promise<void>} putAttempt Stores an authorization attempt under its state.
 * @property {(query: { after: number }) => Promise<Record<string, any> | null>} latestAttempt The newest attempt that expires after `after`.
 * @property {(state: string) => Promise<Record<string, any> | null>} consumeAttempt Removes and answers the attempt with this state.
 */

/**
 * Where connections are kept: createKnexConnectionStore(),
 * createFileConnectionStore() or the application's own store.
 * @typedef {object} ConnectionStore
 * @property {<T>(slot: { owner: ConnectionOwner, integrationId: string }, work: (record: ConnectionRecord) => Promise<T>, options?: { readOnly?: boolean }) => Promise<T>} withConnection
 *   Runs the work with the connection locked. With `readOnly`, the work only reads `connection`, and the store may
 *   skip the lock and the row it would otherwise create.
 */

/**
 * The request a provider operation sends.
 * @typedef {object} ConnectorRequest
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} [headers]
 * @property {any} [body]
 */

/**
 * One operation a provider offers.
 * @typedef {object} ConnectorOperation
 * @property {string[]} scopes The permissions of which one must be granted; an empty list always runs.
 * @property {(input: any, settings: Record<string, any>, providerData?: any) => ConnectorRequest} request
 *   Builds the request for an input; throws an error with `fieldErrors` for an invalid one.
 * @property {(result: any, request: ConnectorRequest) => boolean} [validateResult] Answers whether the response is what was asked.
 * @property {string} [assistantAction] The assistant action whose permission covers it; its operation id otherwise.
 * @property {string[]} [authenticationMethods] The credential modes it runs with; every mode otherwise.
 * @property {boolean} [sideEffect] True for an operation that acts on the world: sends a message, charges, books or
 *   posts. Outside production (APP_ENV), it is checked and logged, never sent, and answers
 *   `{ simulated: true }`.
 */

/**
 * What a provider's exchange() receives besides the URL and the request options.
 * @typedef {object} ConnectorExchangeTransport
 * @property {typeof globalThis.fetch} fetchImpl
 * @property {ReturnType<typeof import("@jskit-ai/http-runtime/client").createHttpClient>["request"]} request The parsed-JSON HTTP client.
 * @property {ResolveReference} resolveReference
 * @property {Record<string, any>} settings
 * @property {string | undefined} apiKey The API key of an API-key connection; undefined otherwise.
 */

/**
 * A connector provider: its shared definition (id, scopes, credential modes,
 * account modes and settings, which validateIntegrationConfiguration() reads)
 * and the server runtime createConnectionService() calls. A field given as a
 * value or as a function of the settings may take either form.
 * @typedef {object} ConnectorProvider
 * @property {string} id
 * @property {Record<string, ConnectorOperation>} operations
 * @property {string | ((method: string) => string)} checkOperation The operation that verifies a connection.
 * @property {string[] | ((settings: Record<string, any>, providerData?: any) => string[])} apiOrigins The HTTPS origins its requests may reach.
 * @property {(settings: Record<string, any>) => string[]} [authenticationMethodsForSettings] The credential modes for these settings, in place of the definition's list.
 * @property {(settings: Record<string, any>) => string[]} [accountModesForSettings] The account modes for these settings, in place of the definition's list.
 * @property {(grantType: string, settings: Record<string, any>) => Array<{ value: string }>} [scopesForGrantType] The scopes an OAuth grant type offers.
 * @property {(settings: Record<string, any>) => Array<{ value: string }>} [scopesForSettings] The scopes for these settings, in place of the definition's list.
 * @property {(clientId: string) => unknown} [validateClientId] True for a client ID the provider accepts; otherwise its field error.
 * @property {(settings: Record<string, any>) => object} [runtimeForSettings] Runtime fields that replace these for the integration's settings.
 * @property {Array<{ value: string }>} [assistantActions]
 * @property {number} [requestTimeoutMs] The timeout of its operations and service-account grants. Defaults to 15 seconds, the timeout of every OAuth token request.
 * @property {string} [scopeSeparator] Defaults to a space.
 * @property {object | ((settings: Record<string, any>) => object)} [oauth] The OAuth authorization server metadata.
 * @property {string | ((settings: Record<string, any>) => string)} [oauthResource]
 * @property {boolean} [oauthPkce] False for a provider without PKCE.
 * @property {string} [oauthBasicEncoding] "raw" sends Basic client credentials without form encoding.
 * @property {string} [oauthClientIdParameter] The parameter that carries the client ID, when it is not `client_id`.
 * @property {(client: { clientId: string }) => Record<string, string>} [oauthHeaders]
 * @property {Record<string, string>} [authorizationParameters]
 * @property {(settings: Record<string, any>) => string | undefined} [authorizationScopeParameter]
 * @property {boolean} [scopesInAuthorizationResponse]
 * @property {string} [tokenRequestEncoding] "json" sends every token request as JSON instead of a form.
 * @property {number} [tokenRefreshLeewayMs] Defaults to 30 seconds.
 * @property {boolean} [refreshRequiresRedirectUri]
 * @property {(callbackUrl: string) => boolean} [validateCallbackUrl]
 * @property {(response: Response, details: { settings: Record<string, any>, grantType: string }) => Response | Promise<Response>} [normalizeTokenResponse]
 * @property {(response: any, previous: any) => any} [dataFromTokenResponse]
 * @property {(verification: any) => string} [accountLabelFromVerification]
 * @property {(verification: any, client: { clientId: string }) => string[]} [grantedScopesFromVerification]
 * @property {(request: { credential: string, settings: Record<string, any>, scopes: string[], fetchImpl: typeof globalThis.fetch, signal: AbortSignal, now: number }) => Promise<any>} [serviceAccountGrant]
 * @property {{ headers?: (apiKey: string, settings: Record<string, any>) => Record<string, string>, queryParameter?: string, bodyParameter?: string, pathPrefix?: (apiKey: string) => string }} [apiKey]
 *   Where an API-key connection places its key.
 * @property {boolean} [apiKeySecretOptional]
 * @property {(url: string, options: object, transport: ConnectorExchangeTransport) => Promise<any>} [exchange]
 *   Sends the request itself, for a protocol such as MCP or AWS Signature Version 4.
 */

export {};
