# JSKIT Experts Manual (AI Canonical): Kernel Server Real Applications

Audience: expert engineers and AI agents. This is a code-accurate operating reference, not a tutorial.

## Contract Of This Chapter

- Canonical runtime model is current Stage 10 (`03.real-app`) plus current kernel APIs.
- This chapter includes the practical Chapter 2 server knowledge (Application, providers, container, routing, errors), but written in contract form.
- If you need one provider to emulate for "best practices", use `Stage10ConfigContractProvider`.

## Canonical Files (Read First)

Runtime entry and assembly:

- `tooling/create-app/templates/base-shell/server.js`
- `packages/kernel/server/platform/surfaceRuntime.js`
- `packages/kernel/server/platform/providerRuntime.js`
- `packages/kernel/server/kernel/lib/application.js`
- `packages/kernel/server/container/lib/container.js`
- `packages/kernel/server/http/lib/kernel.js`
- `packages/kernel/server/http/lib/router.js`
- `packages/kernel/server/http/lib/routeContract.js`
- `packages/kernel/server/http/lib/controller.js`
- `packages/kernel/server/runtime/fastifyBootstrap.js`
- `packages/kernel/server/runtime/moduleConfig.js`
- `packages/kernel/server/runtime/errors.js`
- `packages/kernel/shared/support/tokens.js`

Stage 10 implementation reference:

- `docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`
- `docs/examples/03.real-app/src/server/support/stage10Middleware.js`
- `docs/examples/03.real-app/src/server/controllers/ContactControllerStage10.js`
- `docs/examples/03.real-app/src/server/actions/CreateContactIntakeActionStage10.js`
- `docs/examples/03.real-app/src/server/actions/PreviewContactFollowupActionStage10.js`
- `docs/examples/03.real-app/src/server/services/ContactQualificationService.js`
- `docs/examples/03.real-app/src/server/services/ContactDomainRulesServiceStage10.js`
- `docs/examples/03.real-app/src/server/support/contactsModuleConfigStage10.js`
- `docs/examples/03.real-app/src/server/support/domainRuleValidation.js`

## One-Line Answer: "Which Provider Is Best Practice?"

Use this as the primary reference:

- `docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`

And also copy its adjacent patterns:

- reusable cross-route middleware stack: `docs/examples/03.real-app/src/server/support/stage10Middleware.js`
- thin controller with shared HTTP helpers: `docs/examples/03.real-app/src/server/controllers/ContactControllerStage10.js`
- actions for orchestration, services for domain logic, repository for persistence shape
- startup config contract via `defineModuleConfig`

## End-To-End Startup Pipeline

From template app runtime (`server.js`):

1. Build Fastify and validator compiler.
2. Resolve env (`resolveRuntimeEnv`).
3. Resolve runtime profile (`resolveRuntimeProfileFromSurface`).
4. Build provider runtime from lock and providers (`tryCreateProviderRuntimeFromApp`).
5. Register surface access guard (`registerSurfaceRequestConstraint`).
6. Start listening.

Important behavior:

- If lock file is missing, `tryCreateProviderRuntimeFromApp` returns `null` (graceful).
- Otherwise, runtime assembly errors are thrown.

## Runtime Data Structures (Exact Shapes)

### `createProviderRuntimeFromApp(...)` return shape

```js
type ProviderRuntime = {
  app: Application,
  routeCount: number,
  routeRegistration: { routeCount: number },
  diagnostics: {
    profile: string,
    providerOrder: string[],
    registeredOrder: string[],
    bootedOrder: string[],
    timings: {
      register: Record<string, number>,
      boot: Record<string, number>,
      shutdown: Record<string, number>
    }
  },
  packageOrder: string[],
  globalUiPaths: string[],
  providerPackageOrder: string[],
  appLocalProviderOrder: string[]
}
```

### Route object shape (`HttpRouter.register` stores)

```js
type RouteRecord = {
  id: string,
  method: string,
  path: string,
  schema?: object,
  input?: {
    body?: (body, request) => unknown,
    query?: (query, request) => unknown,
    params?: (params, request) => unknown
  },
  config: object,
  auth?: unknown,
  workspacePolicy?: unknown,
  workspaceSurface?: unknown,
  permission?: unknown,
  ownerParam?: unknown,
  userField?: unknown,
  ownerResolver?: unknown,
  csrfProtection?: unknown,
  bodyLimit?: unknown,
  middleware: Array<string | Function>,
  handler: Function
}
```

### Request context shape added at execution

When request scope is enabled (default in `registerRoutes`):

- `request.scope` is a container scope
- tokens bound in that scope:
  - `KERNEL_TOKENS.Request`
  - `KERNEL_TOKENS.Reply`
  - `KERNEL_TOKENS.RequestId`
  - `KERNEL_TOKENS.RequestScope`
- if route has input transforms, `request.input` is created:

```js
request.input = {
  body: <normalized or raw request.body>,
  query: <normalized or raw request.query>,
  params: <normalized or raw request.params>
}
```

## Chapter 2 Knowledge (Canonical API Contract)

Full server-side public map that matters for provider authoring:

- `Application`, `createApplication`, `createProviderClass` (`@jskit-ai/kernel/server/kernel`)
- `ServiceProvider` (`@jskit-ai/kernel/server/kernel`)
- `Container`, `createContainer` (`@jskit-ai/kernel/server/container`)
- `HttpRouter`, `createRouter`, `joinPath` (`@jskit-ai/kernel/server/http`)
- `defineRouteContract`, `compileRouteContract`, `resolveRouteContractOptions` (`@jskit-ai/kernel/server/http`)
- `BaseController`, `resolveDomainErrorStatus` (`@jskit-ai/kernel/server/http`)
- `registerRoutes`, `registerHttpRuntime`, `createHttpRuntime` (`@jskit-ai/kernel/server/http`)
- `registerApiRouteDefinitions` (`@jskit-ai/kernel/server/runtime`)

## 1) Application + Provider lifecycle

Primary type: `Application` (`@jskit-ai/kernel/server/kernel`).

Core methods:

- `bind(token, factory)` -> transient
- `singleton(token, factory)` -> shared instance in binding container
- `scoped(token, factory)` -> one instance per current scope
- `instance(token, value)` -> fixed value
- `make(token)` -> resolve required token
- `has(token)` -> optional presence check
- `createScope(scopeId)` -> child container
- `tag(token, tagName)` / `resolveTag(tagName)` -> group resolution
- `start({ providers })` -> normalize, sort, register, boot
- `shutdown()` -> reverse boot order
- `getDiagnostics()` -> startup/shutdown observability

Provider contract:

- provider id: `static id = "..."` (required)
- ordering: `static dependsOn = ["provider.id"]` (optional)
- lifecycle methods: `register(app)`, `boot(app)`, `shutdown(app)`

Execution order with dependencies:

- register phase follows dependency order
- boot phase follows dependency order
- shutdown phase runs reverse boot order

Use guidance:

- required dependency: call `app.make(token)`
- optional dependency: guard with `app.has(token)`

## 2) Container behavior (DI semantics)

Token types:

- non-empty string
- symbol
- function (class/function token)

Lifetime semantics:

- `bind`: factory executes every resolve
- `singleton`: first resolve caches on binding container
- `scoped`: first resolve caches on current scope container
- `instance`: value is prebound immediately

Error semantics:

- duplicate token binding -> `DuplicateBindingError`
- unresolved token -> `UnresolvedTokenError`
- circular dependency -> `CircularDependencyError`
- invalid token/factory -> `InvalidTokenError` / `InvalidFactoryError`

## 3) HTTP router + route contracts

Route definition APIs (`@jskit-ai/kernel/server/http`):

- `HttpRouter.register/get/post/put/patch/delete`
- `HttpRouter.group({ prefix, middleware }, defineRoutes)`
- `HttpRouter.resource(...)`
- `HttpRouter.apiResource(...)`
- `HttpRouter.list()`
- `createRouter(options)`
- `joinPath(left, right)`

Route contract keys:

- `meta`
- `body`
- `query`
- `params`
- `response`
- `advanced`

Contract compile mapping:

- `meta.tags` -> `schema.tags`
- `meta.summary` -> `schema.summary`
- `body.schema` -> `schema.body`
- `query.schema` -> `schema.querystring`
- `params.schema` -> `schema.params`
- `response` -> `schema.response`
- `body/query/params.normalize` -> `request.input.*`
- `advanced.fastifySchema` merges into Fastify schema
- `advanced.jskitInput` merges extra input transforms

Runtime registration APIs:

- `registerRoutes(fastify, options)`
- `registerHttpRuntime(app, options)`
- `createHttpRuntime({ app, fastify, router })`
- `defaultApplyRoutePolicy(...)`
- `normalizeRoutePolicyConfig(...)`
- `defaultMissingHandler(request, reply)`

Middleware model:

- route middleware entries can be functions or names
- named middleware resolves from runtime aliases/groups
- unknown names or group cycles throw `RouteRegistrationError`

## 4) Controller base helper contract

`BaseController` (`@jskit-ai/kernel/server/http`) offers:

- `ok`, `created`, `noContent`
- `fail`
- `sendActionResult`
- domain code to status mapping via `resolveDomainErrorStatus`

Use it for standardized payload/status/header behavior.

## 5) Error classes and when to throw

Kernel/provider lifecycle:

- `KernelError`
- `ProviderNormalizationError`
- `DuplicateProviderError`
- `ProviderDependencyError`
- `ProviderLifecycleError`

Container:

- `ContainerError`
- `InvalidTokenError`
- `InvalidFactoryError`
- `DuplicateBindingError`
- `UnresolvedTokenError`
- `CircularDependencyError`

HTTP:

- `HttpKernelError`
- `RouteDefinitionError`
- `RouteRegistrationError`

Runtime/API (app-level):

- `AppError`
- `DomainError`
- `DomainValidationError`
- `ConflictError`
- `NotFoundError`
- helper: `createValidationError`

Guideline:

- app/domain code should usually throw `AppError` family
- kernel/container/http errors are mostly framework contract errors

## 6) Public service-provider classes exposed by server package

From `@jskit-ai/kernel/server` exports:

- `ContainerCoreServiceProvider`
- `HttpFastifyServiceProvider`
- `KernelCoreServiceProvider`
- `PlatformServerRuntimeServiceProvider`
- `ServerRuntimeCoreServiceProvider`
- `SupportCoreServiceProvider`
- `SurfaceRoutingServiceProvider`

## Stage 10 Canonical Composition (Current)

`Stage10ConfigContractProvider.register(app)` wires:

- config singleton via `contactsModuleConfig.resolve({ env })`
- repository
- qualification service
- domain-rules service
- create action
- preview action
- controller

`Stage10ConfigContractProvider.boot(app)` wires:

- global API error handler (`registerApiErrorHandler`) with single-install marker
- two POST routes
- shared route options (body schema + body normalize + middleware + response schema)

Current Stage 10 route contract:

- body schema: `contactBodySchema`
- body normalize: trim/canonicalize payload fields
- middleware: `stage10ContactsMiddleware`
- response schema: `withStandardErrorResponses({ 200: contactSuccessSchema }, { includeValidation400: true })`
- no Stage 10 query contract in current provider

Current Stage 10 middleware stack order (`stage10ContactsMiddleware`):

1. `requireRequestScopeMiddleware`
2. `attachRequestContextMiddleware`
3. `requirePartnerConsentMiddleware`

Request-scope context behavior:

- middleware stores context in request scope under `STAGE_10_REQUEST_CONTEXT_TOKEN`
- controller reads `KERNEL_TOKENS.RequestId` and that context from `request.scope`
- controller sets response headers:
  - `x-request-id`
  - `x-request-received-at`
  - `x-contacts-mode`
  - `x-contacts-max-starter-employees`

## Config Contract Pattern (Stage 10)

Use `defineModuleConfig` for startup-safe config:

- schema: TypeBox object
- load: from env
- transform: coerce/normalize user input
- validate: custom invariant checks
- coerce: enable Parse-mode coercion
- freeze: default true (deep frozen result)

Stage 10 env contract example:

- `CONTACTS_MODE`
- `CONTACTS_ALLOWED_COUNTRIES`
- `CONTACTS_MAX_STARTER_EMPLOYEES`
- `CONTACTS_BLOCK_DISPOSABLE_EMAILS`

## Symbol Token Rule

`KERNEL_TOKENS` uses `Symbol.for("...")` so token identity is shared through the runtime global symbol registry. That prevents accidental token identity splits across modules.

## If Asked: "Make A Provider Using Best Practices"

Use this generation target exactly:

- emulate `Stage10ConfigContractProvider` shape
- include reusable middleware module (not inline duplication)
- thin controller, action orchestration, service logic, repository persistence boundary
- startup config via `defineModuleConfig`
- route contracts with schema + normalize + response
- route-level reusable middleware array
- `registerApiErrorHandler` once with marker token

Mandatory provider checklist:

1. Define stable provider id and optional dependsOn.
2. Register only bindings in `register`; avoid route wiring there.
3. Resolve env/logger from tokens (`KERNEL_TOKENS.Env`, `KERNEL_TOKENS.Logger`) when needed.
4. Resolve router in `boot` and register routes there.
5. Put normalization in route contract (`body/query/params.normalize`).
6. Use `request.input.*` in controllers when normalize exists.
7. Throw `AppError`/`DomainError` subclasses for expected failures.
8. Keep controller transport-focused; move orchestration to actions.
9. Put optional dependencies behind `app.has`.
10. Keep tokens deterministic and namespaced (`<module>.<layer>.<name>`).

Anti-patterns to avoid:

- monolithic provider handlers with domain logic inline
- duplicated validation/scoring logic across endpoints
- reading raw `request.body` when normalized input exists
- hidden global state outside container/repository boundaries
- ad-hoc route error payloads instead of shared error handling

## Copyable Provider Skeleton (AI Baseline)

```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { isAppError, registerApiErrorHandler } from "@jskit-ai/kernel/server/runtime";

const MODULE_CONFIG = "acme.contacts.config";
const MODULE_CONTROLLER = "acme.contacts.controller";
const MODULE_ERROR_HANDLER_MARKER = "acme.contacts.errorHandlerRegistered";

class AcmeContactsProvider {
  static id = "acme.contacts";

  register(app) {
    // Bind config/services/actions/controller here.
  }

  boot(app) {
    if (!app.has(MODULE_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), { isAppError });
      app.instance(MODULE_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(MODULE_CONTROLLER);

    const sharedOptions = {
      body: {
        schema: {},
        normalize: (body) => body
      },
      middleware: [],
      response: withStandardErrorResponses({ 200: {} }, { includeValidation400: true })
    };

    router.register(
      "POST",
      "/api/v1/acme/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/acme/contacts/intake",
        ...sharedOptions,
        meta: {
          tags: ["acme-contacts"],
          summary: "Create contact intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );
  }
}

export { AcmeContactsProvider };
```

## Fast Verification Commands

```bash
# server runtime build/test area
npm test --workspace @jskit-ai/kernel

# jskit cli test area mentioned in handover
npm test --workspace @jskit-ai/jskit-cli

# confirm template server runtime surface
node tooling/jskit-cli/bin/jskit.js --help
```

Use this document as the generation contract for AI-authored server providers in this repository.
