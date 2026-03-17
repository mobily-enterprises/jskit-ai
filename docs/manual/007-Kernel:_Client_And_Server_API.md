# JSKIT Manual: Chapter 7 Client and Server Kernel API

This chapter is the canonical API reference for the public kernel API exposed for client and server work.

Runnable chapter example package:

- `docs/examples/07.kernel-api-reference`

Source of truth:

- package exports in `packages/kernel/package.json`
- symbol exports in `packages/kernel/client/index.js` and `packages/kernel/server/*/index.js`

## Client API

Client main entrypoint (`@jskit-ai/kernel/client`) exports:

- `AUTH_POLICY_AUTHENTICATED`
- `AUTH_POLICY_PUBLIC`
- `WEB_ROOT_ALLOW_YES`
- `WEB_ROOT_ALLOW_NO`
- `DEFAULT_GUARD_EVALUATOR_KEY`
- `createFallbackNotFoundRoute`
- `buildSurfaceAwareRoutes`
- `createShellBeforeEachGuard`
- `CLIENT_MODULE_RUNTIME_APP_TOKEN`
- `CLIENT_MODULE_ROUTER_TOKEN`
- `CLIENT_MODULE_VUE_APP_TOKEN`
- `CLIENT_MODULE_ENV_TOKEN`
- `CLIENT_MODULE_SURFACE_RUNTIME_TOKEN`
- `CLIENT_MODULE_SURFACE_MODE_TOKEN`
- `CLIENT_MODULE_LOGGER_TOKEN`
- `createClientRuntimeApp`
- `registerClientModuleRoutes`
- `bootClientModules`
- `resolveClientBootstrapDebugEnabled`
- `createClientBootstrapLogger`
- `createSurfaceShellRouter`
- `createShellRouter` (alias of `createSurfaceShellRouter`)
- `bootstrapClientShellApp`

Client Vite entrypoint (`@jskit-ai/kernel/client/vite`) exports:

- `CLIENT_BOOTSTRAP_VIRTUAL_ID`
- `CLIENT_BOOTSTRAP_RESOLVED_ID`
- `createVirtualModuleSource`
- `resolveInstalledClientPackageIds`
- `createJskitClientBootstrapPlugin`

Client direct subpaths available from package exports:

- `@jskit-ai/kernel/client/shellRouting`
- `@jskit-ai/kernel/client/moduleBootstrap`

## Shared API (Cross-Client/Server)

Shared aggregate entrypoint (`@jskit-ai/kernel/shared`) re-exports support and surface APIs.

Shared support entrypoint (`@jskit-ai/kernel/shared/support`) exports:

- `KERNEL_TOKENS`
- `normalizeText`
- `normalizeObject`
- `normalizeArray`
- `normalizeInteger`
- `ensureNonEmptyText`
- `sortStrings`
- `sortById`

Shared support direct subpaths available from package exports:

- `@jskit-ai/kernel/shared/support/tokens`
- `@jskit-ai/kernel/shared/support/normalize`
- `@jskit-ai/kernel/shared/support/sorting`

Shared surface entrypoint (`@jskit-ai/kernel/shared/surface`) exports:

- `createSurfaceRegistry`
- `normalizeSurfaceId`
- `createSurfacePathHelpers`
- `createSurfaceRuntime`
- `filterRoutesBySurface`
- `escapeRegExp`
- `API_BASE_PATH`
- `API_MAJOR_VERSION`
- `API_VERSION_SEGMENT`
- `API_PREFIX`
- `API_PREFIX_SLASH`
- `API_DOCS_PATH`
- `API_REALTIME_PATH`
- `normalizePathname`
- `isApiPath`
- `isVersionedApiPath`
- `toVersionedApiPath`
- `toVersionedApiPrefix`
- `buildVersionedApiPath`
- `isVersionedApiPrefixMatch`
- `DEFAULT_SURFACES`
- `DEFAULT_ROUTES`
- `createDefaultAppSurfaceRegistry`
- `createDefaultAppSurfacePaths`

Shared surface direct subpaths available from package exports:

- `@jskit-ai/kernel/shared/surface/apiPaths`
- `@jskit-ai/kernel/shared/surface/appSurfaces`
- `@jskit-ai/kernel/shared/surface/paths`
- `@jskit-ai/kernel/shared/surface/runtime`
- `@jskit-ai/kernel/shared/surface/registry`
- `@jskit-ai/kernel/shared/surface/escapeRegExp`

## Server API

Server aggregate entrypoint (`@jskit-ai/kernel/server`) is intentionally minimal and exports only core server providers (use domain entrypoints such as `@jskit-ai/kernel/server/runtime` and `@jskit-ai/kernel/server/http` for APIs).

Server container entrypoint (`@jskit-ai/kernel/server/container`) exports:

- `Container`
- `createContainer`
- `tokenLabel`
- `ContainerError`
- `InvalidTokenError`
- `InvalidFactoryError`
- `DuplicateBindingError`
- `UnresolvedTokenError`
- `CircularDependencyError`
- `ContainerCoreServiceProvider`

Server HTTP entrypoint (`@jskit-ai/kernel/server/http`) exports:

- `HttpKernelError`
- `RouteDefinitionError`
- `RouteRegistrationError`
- `HttpRouter`
- `createRouter`
- `joinPath`
- `defaultMissingHandler`
- `defaultApplyRoutePolicy`
- `normalizeRoutePolicyConfig`
- `registerRoutes`
- `registerHttpRuntime`
- `createHttpRuntime`
- `HttpFastifyServiceProvider`

Server kernel entrypoint (`@jskit-ai/kernel/server/kernel`) exports:

- `Application`
- `createApplication`
- `createProviderClass`
- `ServiceProvider`
- `KernelError`
- `ProviderNormalizationError`
- `DuplicateProviderError`
- `ProviderDependencyError`
- `ProviderLifecycleError`
- `KernelCoreServiceProvider`

Server platform entrypoint (`@jskit-ai/kernel/server/platform`) exports:

- `createPlatformRuntimeBundle`
- `createServerRuntime`
- `createServerRuntimeWithPlatformBundle`
- `createProviderRuntimeApp`
- `createProviderRuntimeFromApp`
- `toRequestPathname`
- `shouldServePathForSurface`
- `registerSurfaceRequestConstraint`
- `resolveRuntimeProfileFromSurface`
- `tryCreateProviderRuntimeFromApp`
- `PlatformServerRuntimeServiceProvider`

Server runtime entrypoint (`@jskit-ai/kernel/server/runtime`) exports:

- `isAppError`
- `isDomainError`
- `AppError`
- `DomainError`
- `DomainValidationError`
- `ConflictError`
- `NotFoundError`
- `createValidationError`
- `parsePositiveInteger`
- `safeRequestUrl`
- `safePathnameFromRequest`
- `buildLoginRedirectPathFromRequest`
- `resolveClientIpAddress`
- `normalizePagination`
- `buildPublishRequestMeta`
- `normalizeHeaderValue`
- `publishSafely`
- `resolvePublishMethod`
- `warnPublishFailure`
- `createRealtimeEventEnvelope`
- `createRealtimeEventsBus`
- `createTargetedChatEventEnvelope`
- `normalizeEntityId`
- `normalizePositiveIntegerArray`
- `normalizePositiveIntegerOrNull`
- `normalizeScopeKind`
- `normalizeStringifiedPositiveIntegerOrNull`
- `normalizeStringOrNull`
- `createService`
- `buildAuditEventBase`
- `buildAuditError`
- `recordAuditEvent`
- `withAuditEvent`
- `createRepositoryRegistry`
- `createServiceRegistry`
- `createControllerRegistry`
- `selectRuntimeServices`
- `createRuntimeComposition`
- `resolveLoggerLevel`
- `createFastifyLoggerOptions`
- `registerRequestLoggingHooks`
- `registerApiErrorHandler`
- `resolveDatabaseErrorCode`
- `recordDbErrorBestEffort`
- `runGracefulShutdown`
- `normalizeRuntimeBundle`
- `createRuntimeKernel`
- `mergeRuntimeBundles`
- `createRuntimeAssembly`
- `buildRoutesFromManifest`
- `registerApiRouteDefinitions`
- `ModuleConfigError`
- `defineModuleConfig`
- `defaultMissingHandler`
- `normalizeIdempotencyKey`
- `requireIdempotencyKey`
- `resolveFsBasePath`
- `readLockFromApp`
- `ServerRuntimeCoreServiceProvider`
- `toCanonicalJson`
- `toSha256Hex`
- `toHmacSha256Hex`
- `safeParseJson`
- `canonicalJsonTestables`

Server support entrypoint (`@jskit-ai/kernel/server/support`) exports:

- `KERNEL_TOKENS`
- `normalizeText`
- `normalizeObject`
- `normalizeArray`
- `normalizeInteger`
- `ensureNonEmptyText`
- `sortStrings`
- `sortById`
- `SupportCoreServiceProvider`

Server surface entrypoint (`@jskit-ai/kernel/server/surface`) exports:

- `createSurfaceRegistry`
- `normalizeSurfaceId`
- `createSurfacePathHelpers`
- `createSurfaceRuntime`
- `filterRoutesBySurface`
- `escapeRegExp`
- `API_BASE_PATH`
- `API_MAJOR_VERSION`
- `API_VERSION_SEGMENT`
- `API_PREFIX`
- `API_PREFIX_SLASH`
- `API_DOCS_PATH`
- `API_REALTIME_PATH`
- `normalizePathname`
- `isApiPath`
- `isVersionedApiPath`
- `toVersionedApiPath`
- `toVersionedApiPrefix`
- `buildVersionedApiPath`
- `isVersionedApiPrefixMatch`
- `DEFAULT_SURFACES`
- `DEFAULT_ROUTES`
- `createDefaultAppSurfaceRegistry`
- `createDefaultAppSurfacePaths`
- `SurfaceRoutingServiceProvider`

Server direct subpaths available from package exports:

- `@jskit-ai/kernel/server/container/*`
- `@jskit-ai/kernel/server/http/*`
- `@jskit-ai/kernel/server/http/kernel`
- `@jskit-ai/kernel/server/kernel/*`
- `@jskit-ai/kernel/server/platform/providerRuntime`
- `@jskit-ai/kernel/server/platform/runtime`
- `@jskit-ai/kernel/server/platform/surfaceRuntime`
- `@jskit-ai/kernel/server/runtime/*`

## Application API (Detailed Reference)

`Application` constructor:

- `new Application({ profile, strict, container })`

`Application` methods:

- `bind(token, factory)`
- `singleton(token, factory)`
- `scoped(token, factory)`
- `instance(token, value)`
- `make(token)`
- `has(token)`
- `createScope(scopeId)`
- `tag(token, tagName)`
- `resolveTag(tagName)`
- `normalizeProviderEntries(providers)`
- `normalizeProviderEntry(rawProvider)`
- `sortProviderGraph(entries)`
- `configureProviders(providers)`
- `registerProviders()`
- `bootProviders()`
- `start({ providers })`
- `shutdown()`
- `getDiagnostics()`

Adjacent helpers from `@jskit-ai/kernel/server/kernel`:

- `createApplication(options)`
- `createProviderClass({ id, dependsOn, register, boot, shutdown })`
