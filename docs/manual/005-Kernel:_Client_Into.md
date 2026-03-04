# JSKIT Manual: Chapter 5 The Client Side

This chapter defines the full client-side coverage scope.

Runnable chapter example packages:

- `docs/examples/05.kernel-client`
- `docs/examples/tut-custom-client-routes-dec`
- `docs/examples/tut-custom-client-routes-prog`

## Scope

- client runtime mental model and lifecycle
- client routing and surface-aware behavior
- client module bootstrapping and route registration
- client-side debugging/errors and practical workflows
- Vite integration for client bootstrap
- shared APIs used by client code

## Client Core APIs (`@jskit-ai/kernel/client`)

- `createClientRuntimeApp`
- `bootClientModules`
- `registerClientModuleRoutes`
- `CLIENT_MODULE_RUNTIME_APP_TOKEN`
- `CLIENT_MODULE_ROUTER_TOKEN`
- `CLIENT_MODULE_VUE_APP_TOKEN`
- `CLIENT_MODULE_ENV_TOKEN`
- `CLIENT_MODULE_SURFACE_RUNTIME_TOKEN`
- `CLIENT_MODULE_SURFACE_MODE_TOKEN`
- `CLIENT_MODULE_LOGGER_TOKEN`

## Client Shell and Routing APIs (`@jskit-ai/kernel/client`)

- `createSurfaceShellRouter`
- `createShellRouter` (alias)
- `createFallbackNotFoundRoute`
- `buildSurfaceAwareRoutes`
- `createShellBeforeEachGuard`
- `AUTH_POLICY_AUTHENTICATED`
- `AUTH_POLICY_PUBLIC`
- `WEB_ROOT_ALLOW_YES`
- `WEB_ROOT_ALLOW_NO`
- `DEFAULT_GUARD_EVALUATOR_KEY`

## Client Bootstrap APIs (`@jskit-ai/kernel/client`)

- `resolveClientBootstrapDebugEnabled`
- `createClientBootstrapLogger`
- `bootstrapClientShellApp`

## Client Vite APIs (`@jskit-ai/kernel/client/vite`)

- `createJskitClientBootstrapPlugin`
- `createVirtualModuleSource`
- `resolveInstalledClientPackageIds`
- `CLIENT_BOOTSTRAP_VIRTUAL_ID`
- `CLIENT_BOOTSTRAP_RESOLVED_ID`

## Shared APIs Used By Client Work (`@jskit-ai/kernel/shared/surface`)

- `createSurfaceRegistry`
- `normalizeSurfaceId`
- `createSurfacePathHelpers`
- `createSurfaceRuntime`
- `filterRoutesBySurface`
- `collectClientModuleRoutes`
- `DEFAULT_SURFACES`
- `DEFAULT_ROUTES`
- `createDefaultAppSurfaceRegistry`
- `createDefaultAppSurfacePaths`

## Practical Topics To Cover With These APIs

- route declaration contract for client modules (`id`, `path`, `component`, `scope`, `surface`)
- how duplicate route names/paths are detected
- how surface filtering changes active routes
- how shell guards are evaluated and how redirects are decided
- how to boot modules before router installation
- how to wire fallback/not-found routes
- how to enable and use client bootstrap debug output
- end-to-end example: add one client module route and verify it appears only on the intended surface
