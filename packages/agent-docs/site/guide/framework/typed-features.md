---
title: Typed features
description: Server features whose collaborators arrive through declared capabilities, typed where they are received and required, never probed.
---

# Typed features

Read this page before writing a server feature, provider, action, service or
repository. The [rules](#rules) say how JSKIT server code is written, each with
a before and after from JSKIT's own packages. [Common mistakes](#common-mistakes)
lists what code that passes the lint rules still gets wrong. The
[worked example](#one-feature-end-to-end) follows one feature from route to
storage.

## The rule

> Every collaborator a feature uses arrives through its declared JSKIT
> capabilities, and is typed where it is received and required, never probed,
> so each call has exactly one visible destination for a reader and for the
> code map.

A *collaborator* is an object or function with behaviour that code calls: a
service, store, repository, runtime, router, publisher, catalogue or clock.
Plain data (an input, a record, a list, an options bag) is not one.

Typed features keep JSKIT's structure: `defineFeature()` and `defineProvider()`
with `requires`, `optional` and `provides`; named actions with input schemas;
route tables that name action ids; `create*` factories that return frozen
objects of named functions; and the CRUD declaration
`defineCrudJsonApiFeature()`. They fix only how dependencies are received and
spelled.

A call such as `accountPreferencesService.updatePreferences(...)` then has one
destination a reader opens in one step: the parameter names its type, and the
type is `ReturnType<typeof createService>` of one file. The architecture
inspector's code map takes the same step through the TypeScript checker, so it
reports the call as exact instead of guessing from the method name. Every habit
the rules forbid breaks that step. A probe or an absent default gives the call
a second, invisible outcome. A slot filled later, or a module-level registry,
makes the destination depend on what ran before.

## Rules

### 1. A provided capability exports its type

- A named `create<Name>` factory builds the value of each provided token, in a
  module of its own (`<name>Runtime.js`, `bookingEngine.js`), never inline in
  `setup()` or in the feature file.
- `src/server/types.js` (`server/types.js` in the kernel) holds one `@typedef`
  per token, derived from that factory and named after the token in PascalCase
  (`feature.invoice-rollup` → `InvoiceRollup`). The package exports it as
  `./server/types`. Each token gets its own name, even when it aliases another
  type (`AppBooks` is crud-core's `CrudResourceApi`).
- A type used in two or more files is named once, in the `types.js` of the
  package that owns it: no repeated `ReturnType<typeof createX>` and no
  repeated `X["y"]`. Knex is `RuntimeKnex`, a router `RuntimeRouter`, a logger
  `RuntimeLogger`. Import a type from its owner, never re-alias it through
  another module.
- Never hand-write an interface for a token with one implementation. Only a
  token with several implementations (`auth.service`) is a hand-written
  contract, in its owning package, with optional operations as optional
  properties. A JSDoc `import("…")` is a type-only reference, so a package
  cycle is no reason to hand-write a type.

```js
// before: each consumer spells the repository's type out
 * @param {ReturnType<typeof import("./consoleSettingsRepository.js").createRepository>} dependencies.consoleSettingsRepository

// after: console-core's types.js names it once
/** @typedef {ReturnType<typeof import("./consoleSettings/consoleSettingsRepository.js").createRepository>} ConsoleSettingsRepository */
 * @param {import("../types.js").ConsoleSettingsRepository} dependencies.consoleSettingsRepository
```

### 2. A received collaborator is typed where it is received

- Destructure collaborators in the signature and type them with a JSDoc
  `@param`. Never take `create<Name>(dependencies)` and read
  `dependencies.x` in the body.
- Every factory, constructor, hook and helper that calls a collaborator is
  typed: `setup()`, `boot()` and `shutdown()` hooks, route registrars,
  formatters, repository helpers and helpers that take a collaborator
  positionally. A hook that only passes capabilities on needs no type.
- Pure helpers (error mappers, id builders, validators) are imported, never
  passed in.
- A description sits inside the `/** */` block, before its tags, never in a
  `//` line above it.
- An optional token is typed `X | null` only at the hook that receives it. The
  hook resolves its named default there, so `null` never flows deeper.

```js
// before: console-core's settings repository
/** @param {import("knex").Knex} knex */
function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("consoleSettingsRepository requires knex.");
  }

// after
/** @param {{ knex: import("@jskit-ai/database-runtime/server/types").RuntimeKnex }} dependencies */
function createRepository({ knex }) {
```

### 3. Collaborators are required

- No `= null`, `= {}` or no-op default on a collaborator or on the
  dependencies object; no `typeof dependency.method === "function"` probe; no
  `dependency?.method?.()`; no "requires x" guard. The capability runtime
  refuses to start without a required token.
- A default that is the production implementation stays:
  `fetchImpl = globalThis.fetch`, `now = Date.now`.
- Resolve each default once, at the feature or at the public entry point.
  Below that, destructure and use: no second default, no `options.x || null`,
  no re-check of what the provider already validated.
- "Optional operation" means some real implementer lacks the method. An
  operation every implementer has, including one that refuses when a feature
  is switched off, is required in the contract and never probed.
- A collaborator has one shape. Never accept `capability.service || capability`.
- The logger is required, typed `RuntimeLogger`. Only where a real caller may
  omit it does it default to the kernel's `silentLogger`
  (`@jskit-ai/kernel/server/runtime/logger`). Never `logger = null` with
  `if (!logger) return`, and never `logger = console`.
- A per-call callback in an options bag is data: resolve it once with a named
  no-op default, `const { onProgress = reportNoProgress } = options`.
- A public entry point that validates what an application passed it, such as
  `defineFeature()` checking a definition, is input validation and stays.

```js
// before: users-core probed an operation every auth provider implements
async function changePassword(request, user, payload, options = {}) {
  // readable-check: allow method-probe - optional operation: changePassword is an optional auth.service operation
  if (typeof authService.changePassword !== "function") {
    throw new AppError(501, "Password change is not available.", { code: "users.security.passwordChangeUnavailable" });
  }

// after
async function changePassword(request, user, payload) {
```

```js
// before: the OIDC issuer client defaulted fetch to nothing and branched on it
function createIssuerClient({ config, store, logger, fetchImpl = null, now = Date.now }) {
  const requestOptions = { ...(fetchImpl ? { [client.customFetch]: fetchImpl } : {}) };

// after
function createIssuerClient({ config, store, logger, fetchImpl = globalThis.fetch, now = Date.now }) {
  const requestOptions = { [client.customFetch]: fetchImpl };
```

### 4. Extension slots are optional capabilities

- A slot is an `optional` token whose default the declaring package names and
  the receiving hook resolves once, with `??`.
- Anything that holds one value is a slot, whatever it is called
  (`register*`, `attach*`, `set*`), and so is module state filled after
  construction (a `let` or an exported `WeakMap` written in `boot()`). The
  capability owns its state: build it in `setup()`, start it in `boot()`, stop
  it in `shutdown()` without `?.`.
- Catalogues stay catalogues: routes on `http.router`, contributors on
  `runtime.bootstrap`, listeners on `runtime.events`, actions and placements.
- When the slot's supplier requires the slot's owner, the two form a cycle.
  Split the part of the owner the supplier needs into its own feature. Until
  then the setter stays, with a `cycle:` comment, and the slot may be typed
  `X | null` while it carries it.

```js
// before: workspaces-core's pending invitations held a registered callback
let acceptanceParticipant = null;
function registerAcceptanceParticipant(participant) { acceptanceParticipant = participant; }
...
if (acceptanceParticipant) {
  await acceptanceParticipant({ invite, user }, { trx });
}

// after: WorkspacesFeature declares the slot and resolves it once
optional: {
  inviteAcceptanceParticipant: "workspaces.invite-acceptance-participant"
},
...
inviteAcceptanceParticipant: inviteAcceptanceParticipant ?? noInviteAcceptanceParticipant,
...
await acceptanceParticipant({ invite, user }, { trx });
```

A package fills the slot by providing the token from a small feature that
requires only what its value needs:

```js
const AppInviteAcceptanceFeature = defineFeature({
  id: "app.invite-acceptance",
  provides: { inviteAcceptanceParticipant: "workspaces.invite-acceptance-participant" },
  setup: () => ({ inviteAcceptanceParticipant: linkAcceptedMember })
});
```

### 5. Actions are one line

- One `create<Name>Actions({ <service> })` per feature, destructured, in
  `<name>Actions.js` (or the package's own `actions.js`). Actions that belong
  to another concern live in a file named after it. An inline `actions()`
  array becomes an unexported `create<Name>Actions()` in the same file.
- Every definition and the list are `Object.freeze`d. Each id is a string
  literal or a module-level string constant.
- `execute: (input, context) => service.method(…)` makes exactly one call: no
  `async` or `await`, no method body, no envelope built in the action (the
  service returns the final result, its JSON:API document included), no
  helper that builds the action or its `execute`, no helper that strips the
  input, no input rebuilt.
- A key the service ignores is passed through with `input`. A key that must
  not reach the service is destructured in the parameter list, still one
  expression with one call:
  `execute: ({ workspaceSlug, ...payload }, context) => service.update(workspaceSlug, payload, { context })`.
- CRUD custom actions keep the declaration's own
  `execute({ input, context, service })` contract, written as a one-line arrow.

```js
// before: auth-core
execute: async (input, context) => logoutOutcome(await authService.logout(requireRequestContext(context, "auth.logout")))

// after: logout() answers { ok, clearSession } itself
execute: (input, context) => authService.logout(resolveRequest(context))
```

### 6. Methods take the validated input as it is

- A service method that only actions call has no `input = {}`,
  `payload = {}` or `options = {}`, and never reads `input?.x`.
- A contract operation that other callers reach too drops `= {}` and `?.` as
  well, since the contract types its input; it still validates what the
  contract receives.
- No second parse of fields the schema validated: destructure with the
  schema's absent value, `{ name, originId = "" }`. Turn `input.x || d` into
  `{ x = d }` only when the schema rejects null and empty values for `x`.
- An options bag whose fields are optional by contract keeps its default where
  callers may omit it, as a repository's `options = {}` with `trx` does.

```js
// before: console-core's settings service
async function updateSettings(input, options = {}) {
  await consoleService.requireConsoleOwner(options?.context, options);

// after: its actions always pass { context }
async function updateSettings(input, { context }) {
  await consoleService.requireConsoleOwner(context);
```

### 7. One request-context form per package

The expression that reads the request, the actor or the workspace from an
action context lives behind one helper per package, and every action passes
the context the same way. Variants with `?.` or `|| null` count as different
forms. The kernel's `resolveRequest(context)` reads the request.

```js
// before: auth-core read the request two ways
execute: (input, context) => authService.oauthStart(input, resolveRequest(context))
execute: (input, context) => authService.resetPassword(requireRequestContext(context, "auth.password.reset"), input)

// after
execute: (input, context) => authService.resetPassword(resolveRequest(context), input)
```

### 8. Factory results are frozen, with named members

- Every `create*` returns `Object.freeze({ … })` of named inner functions, not
  an object of inline methods.
- A factory exposes another factory's functions by name
  (`logout: sessions.logout`), never by spreading it. Spreading is for a
  `decorateService` or `decorateRepository` over the JSKIT CRUD service or
  repository only, whose members are the contract's.

```js
// before: connectors-catalog's Google Ads Search service
return {
  async discover(id) { … },
  async create(reviewId) { … },
  pause: (id) => invoke("campaigns.setStatus", …)
};

// after
async function discover(id) { … }
async function create(reviewId) { … }
...
return Object.freeze({ discover, targets, preview, create, createConversion, campaign, launch, pause, report });
```

### 9. One copy of each helper, concern-sized files

- Each pure helper, function or arrow, exists once per package and is
  imported. Workspaces-core's three record-id resolvers became one
  `common/support/workspaceRecordId.js`, and its copy of users-core's
  `resolveActionUser` became an import of
  `@jskit-ai/users-core/server/resolveActionUser`.
- Files stay under 750 lines and functions under 600, one concern per factory.
- These rules cover every module a capability value is built from, `src/shared`
  modules included.

```js
// before: workspaces-core's settings, directory and members routes each defined one
function resolveWorkspaceSettingsRecordId(record = {}, context = {}) {

// after: each route file imports the one copy
import { resolveWorkspaceRecordId } from "../common/support/workspaceRecordId.js";
```

### 10. Names and comments

- Factories and action creators are `create*`; `build*` names a pure data
  builder (`buildQueryFields`).
- A file is named for what it holds: `<Name>Feature.js` for a `defineFeature`,
  `<Name>Provider.js` for a `defineProvider`, `<name>Runtime.js`,
  `<name>Actions.js`, `<name>Routes.js`. Sibling factories are named alike
  (`createSupabaseSessions`, `createSupabaseOAuthFlows`,
  `createSupabaseAccountFlows`). Auth-core's `auth.contributor.js` became
  `authActions.js`; console-core's `bootConsoleSettingsRoutes.js` became
  `consoleSettingsRoutes.js`.
- Comments describe the code. None narrates history ("was", "now", "until X
  is converted"), and no shim stays behind for a removed option.
- No dead probes, and no blank first line left where a guard was removed.

```js
// before: workspaces-core's route registrars lived in boot*.js files
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/bootWorkspaceSettings.js";

// after
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/workspaceSettingsRoutes.js";
```

## Common mistakes

Each of these passes the lint rules or hides behind an allow comment, and each
breaks the one-step reading the rules protect.

### A collaborator accepted in two shapes "for tests"

```js
const audits = auditsCapability.service || auditsCapability; // tests pass the bare service
```

The type promises one shape, production takes one branch and the tests take
the other, so a reader follows two and the code map guesses. Read `.service`
on a CRUD capability, use a feature capability as it is, and give the test
double the real shape: `{ service: auditsDouble }`.

### A probe on a collaborator that is always present

```js
// readable-check: allow method-probe - optional operation: a repository may lack withTransaction
if (typeof repository.withTransaction !== "function") return work();
```

When every implementer has the method, the reason is untrue and the fallback
is dead code that a test may even pin. "Optional operation" is for a contract
method some real implementer lacks. Call the method, make it required in the
contract, and delete the fallback with any test that only pins it.

### An action built by a helper, given a body, or stripped by a helper

```js
execute: streamAction((input, context) => assistant.streamAnswer(input, context))
async execute(input, context) { const result = await service.read(input); return { data: result }; }
execute: (input, context) => service.update(withoutRouteKeys(input), { context })
```

Actions made by one helper share one `execute`, so neither a reader nor the
map can tell which service each reaches. A body moves service logic into the
action, and a stripping helper reshapes input the schema already validated.
Write each definition literally and frozen, with a constant id and
`execute: (input, context) => service.method(input, { context })`. The service
returns the final result and destructures what it uses.

### A hand-written `(...args: any[]) => Promise<any>` interface

```js
/** @typedef {{ createInvoice: (...args: any[]) => Promise<any> }} InvoiceWrites */
```

A type literal of `any` members turns exact calls into guesses, because the
inspector does not follow property signatures, and it drifts from the real
service. Name the owner's type,
`import("@local/invoices/server/types").InvoicesService`. A package cycle is no
reason: a JSDoc `import("…")` is type-only. Hand-write a contract only for a
token with several implementations, or for a JSKIT token that has no type yet,
named once.

### Spreading an in-package factory into a token value

```js
return { invoices: Object.freeze({ ...createInvoiceReads(dependencies), ...createInvoiceWrites(dependencies) }) };
```

The members have no visible origin, so a reader opens every factory to find
one, and a later spread silently replaces an earlier member. Build each
factory once and name each member: `listInvoices: reads.listInvoices`.

### `= {}` on contract operations

```js
async function createDocument(payload = {}, options = {}) {
async function queryDocuments(query = {}, options = {}) {
```

No caller passes nothing, and the contract already types the input, so the
default only hides a wrong call. Write `createDocument(payload, options)` and
keep validating what the contract receives.

### Input re-parsed after the schema validated it

```js
const name = String(input.name || "").trim();
const ids = normalizeOrderedIds(input.ids);
```

Two validators drift apart, and the service seems to accept values the action
refuses. Destructure with the schema's absent value. Domain invariants stay
with their owner: a store still rejects an invalid label.

### Several request-context forms in one package

```js
context?.actor?.id
options.context.actor.id
actorId(options?.context) || null
```

Each form treats an absent actor differently, so one action behaves
differently depending on the path it takes. Give the package one helper, such
as the feature package pattern's `bookingRequester(context)`, and pass the
context from actions one way.

### Unfrozen results

```js
return { discover() { … }, async create() { … } };
```

A caller can replace a member, inline methods are anonymous to the map, and
the shape is not fixed. Name the inner functions and return
`Object.freeze({ discover, create })`. Freeze action definitions and lists
too.

### The same indexed type spelled out at every use

```js
@param {import("@jskit-ai/crud-core/server/types").CrudResourceApi["service"]} contacts
@param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase["knex"]} knex
```

Every copy must change together, and the type has no home a reader can find.
Name it once in the owner's `types.js` (`ContactsService`, crud-core's
`CrudService` and `CrudRepository`, `RuntimeKnex`) and import that name.

### A guard or comment that cites tests

```js
// readable-check: allow method-probe - tests build the workflow without the invoices service
await trx?.commit?.(); // the test double has no commit
```

Production code shaped around a test double keeps a shape no real caller
uses, and its comment describes the tests instead of the code. Complete the
double with the real shape, or the method with its neutral value, and delete
the guard. An allow reason describes the code, with a prefix from the
vocabulary under [checks](#checks).

### `null` flowing below the receiving hook

```js
setup({ fetchImpl = null }) { return { jobs: createJobs({ fetchImpl }) }; }
// three factories down: if (fetchImpl) { … } else { … }
```

Every level then carries a branch for a value that is resolved once. Make the
value an optional token, resolve it at the hook to a named default, and pass
the result down as required.

### A default resolved twice, or a check repeated

```js
setup({ events }) { return { actions: createActionCatalogue({ events: events || createEventRuntime() }) }; }
function createActionCatalogue({ events = createEventRuntime() } = {}) {
```

Two defaults can disagree, and a second validation of what the provider
already checked suggests the value can still be wrong. Resolve once, at the
feature or the public entry point; below that, destructure and use.

### One probe kind, several treatments

The same guard, such as checking that an option is a Knex transaction, is
labelled `input validation:` in one file, `data:` in another and nothing in a
third. One kind of probe gets one comment, worded the same everywhere
(`platform object: a Knex transaction`), whether or not a rule reports it.

## One feature end to end

The account preferences of `@jskit-ai/users-core` follow every rule. One
request travels through every layer:

```text
PATCH /api/settings/preferences
  -> action "settings.preferences.update"
  -> AccountPreferencesService.updatePreferences()
  -> UserSettingsRepository.updatePreferences()
```

The excerpts below are shortened to the lines that show the style.

### Types the package provides

`src/server/types.js` names the type of each capability the package provides,
and the repositories its services share:

```js
// The types of the users capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./usersRuntime.js").createUsersRuntime>} UsersCore */
/** @typedef {ReturnType<typeof import("./usersExtensions.js").createUsersExtensions>} UsersExtensions */
/** @typedef {ReturnType<typeof import("./usersIdentity.js").createUsersIdentity>} UsersIdentity */

/**
 * The users' settings repository, as the account services receive it.
 * @typedef {ReturnType<typeof import("./common/repositories/userSettingsRepository.js").createRepository>} UserSettingsRepository
 */

export {};
```

`package.json` exports it, so code in another package that requires the
capability names its type:

```json
{
  "exports": {
    "./server/types": "./src/server/types.js"
  }
}
```

```js
/**
 * A service of an application package whose feature requires `users: "users.core"`.
 * @param {{ users: import("@jskit-ai/users-core/server/types").UsersCore }} dependencies
 */
function createWelcomeService({ users }) {
  // `users.services.accountPreferences` has one known type here.
}
```

The generated package inventory lists each typedef of a module as
`type <Name>`.

### The feature

The feature declares what it requires and provides. `setup()` builds the
runtime with the factory in `usersRuntime.js`, registers the routes and a
bootstrap contributor, and types its parameter because it calls
`bootstrap.register()`. `actions()` creates the actions from the services
`setup()` built:

```js
import { createUsersRuntime } from "./usersRuntime.js";

const UsersFeature = defineFeature({
  id: "users.core",
  requires: {
    authService: "auth.service",
    bootstrap: "runtime.bootstrap",
    http: "runtime.http",
    identity: "users.identity",
    storage: "runtime.storage",
    uploads: "runtime.uploads"
  },
  provides: {
    users: "users.core"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} capabilities.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("./types.js").UsersIdentity} capabilities.identity
   * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} capabilities.storage
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   */
  setup({ authService, bootstrap, http, identity, storage, uploads }) {
    const users = createUsersRuntime({ authService, identity, storage });
    registerAccountProfileRoutes(http.router, {
      accountProfileService: users.services.accountProfile,
      authService,
      uploads
    });
    registerAccountPreferencesRoutes(http.router);
    bootstrap.register({
      id: "users.bootstrap",
      order: 100,
      contribute: createUsersBootstrapContributor({
        authService,
        userProfilesRepository: users.repositories.userProfiles,
        userSettingsRepository: users.repositories.userSettings
      }).contribute
    });
    return { users };
  },
  actions({ users }) {
    return [
      ...createAccountProfileActions({ accountProfileService: users.services.accountProfile }),
      ...createAccountPreferencesActions({ accountPreferencesService: users.services.accountPreferences })
    ];
  }
});
```

### The route table

`accountPreferencesRoutes.js` names the action a route runs; the transport
contract comes from the shared resource:

```js
/** @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router */
function registerAccountPreferencesRoutes(router) {
  router.register(
    "PATCH",
    "/api/settings/preferences",
    {
      auth: "required",
      ...createJsonApiResourceRouteContract({
        requestType: "user-preferences",
        responseType: "user-settings",
        body: userSettingsResource.operations.preferencesUpdate.body,
        output: userSettingsResource.operations.view.output,
        outputKind: "record",
        getRecordId: resolveAccountSettingsResourceId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.preferences.update",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}
```

### The actions

`accountPreferencesActions.js` receives the typed service and returns frozen
definitions. The action validates its input once, against the resource's
schema, and its `execute` is one call:

```js
/** @param {{ accountPreferencesService: import("./accountPreferencesService.js").AccountPreferencesService }} dependencies */
function createAccountPreferencesActions({ accountPreferencesService }) {
  return Object.freeze([
    Object.freeze({
      id: "settings.preferences.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: { require: "authenticated" },
      input: userSettingsResource.operations.preferencesUpdate.body,
      output: null,
      idempotency: "optional",
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountPreferencesService.updatePreferences(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    })
  ]);
}
```

The action holds the service it was created with, and the inspector finds it
by its literal id.

### The typed service

The service names the type of each repository it receives, from the package's
`types.js`, and the contract of `auth.service`. It has no defaults and no
guards, its method takes the validated payload as it is, and it returns the
JSON:API document the route sends:

```js
/**
 * A signed-in user's display and regional preferences.
 * @param {object} dependencies
 * @param {import("../types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 */
function createService({ userSettingsRepository, userProfilesRepository, authService }) {
  async function updatePreferences(request, user, payload) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const settings = await userSettingsRepository.updatePreferences(profile.id, payload);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({ profile, settings, securityStatus, authService }));
  }

  return Object.freeze({ updatePreferences });
}

/** @typedef {ReturnType<typeof createService>} AccountPreferencesService */
```

### The repository

The repository receives the JSON REST API it persists through, typed by its
owner. Its options bag, whose `trx` and `context` are optional by contract,
keeps a default:

```js
/** @param {{ api: import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi }} dependencies */
function createRepository({ api }) {
  async function updatePreferences(userId, patch, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  return Object.freeze({ findByUserId, ensureForUserId, updatePreferences });
}
```

### Following the call

From the route, each step is one jump:

1. `request.executeAction({ actionId: "settings.preferences.update" })` reaches
   the action with that literal id.
2. Its `execute` calls `accountPreferencesService.updatePreferences()`;
   `AccountPreferencesService` is `ReturnType<typeof createService>`, so the
   call reaches that function in `accountPreferencesService.js`.
3. `userSettingsRepository.updatePreferences()` is typed by
   `UserSettingsRepository`, so it reaches `userSettingsRepository.js`, the
   storage boundary.

The `server/feature-package` pattern in the
[source pattern library](/patterns/) is the smallest feature to copy: a `types.js`, a typed engine, an optional token with
a named default, one request-context helper and a `bookingEngineActions.js` of
one-line frozen actions.

## Checks

`@jskit-ai/config-eslint` reports code that breaks the rules, as warnings on
`**/src/server/**` in `baseConfig`. `typedFeaturesConfig(globs)` makes them
errors for the globs an application lists. The application foundations list
`packages/*/src/server/**`, `server/**` and `server.js`, so new server code is
held to the rules from the start.

| Rule | Reports |
| --- | --- |
| `jskit/typed-dependencies` | a factory or constructor that receives collaborators, in its signature or by destructuring them in its body, without a JSDoc `@param` type |
| `jskit/required-collaborators` | an absent default, a `typeof` probe, an optional call |
| `jskit/no-slot-setter` | a `set<Name>()` that fills a slot after construction |
| `jskit/no-module-registry` | a module-level `register<Name>()` that writes module state |
| `jskit/one-line-action` | `input = {}`, `input \|\| {}` or `input?.` in an action, an `async` `execute`, and a definition that is not frozen |
| `jskit/no-duplicate-helper` | a small helper, function or arrow, repeated in another file of the package |
| `max-lines`, `max-lines-per-function` | files over 750 lines, functions over 600 |

The rules see shapes, not intent: everything under
[common mistakes](#common-mistakes) is checked by reading.

A justified exception carries a `// readable-check: allow <rule> - <reason>`
comment on the line before it. The reason starts with one of these prefixes
and says what is true of the code, never the state of a project or its tests:

| Reason prefix | The exception |
| --- | --- |
| `input validation:` | a public library entry point checks a value an application passes it, and refuses a wrong one with its own error |
| `data:` | probes data (a route definition, a transport, a parsed record), not a collaborator |
| `platform object:` | probes a host or library object reached internally, such as `Headers`, a fetch `Response` or a Knex transaction (`platform object: a Knex transaction`) |
| `optional operation:` | calls a contract method that some real implementer lacks, which the contract marks optional |
| `test asserts error:` | keeps a guard whose error a test asserts |
| `not a slot:` | matched a name that fills no slot |
| `cycle: <supplier> requires <owner>` | keeps a setter because the slot's supplier requires its owner |
| `deferred until boot: <reason>` | keeps a capability handed out at setup and filled in `boot()`, such as the deferred `auth.service`: a two-phase value that is neither a cycle nor a setter |
| `filled by <repository>; convert with its supplier` | keeps a setter that another repository's code calls |
| `cross-repository slot <token>` | keeps a probe for a token another repository supplies |

One kind of probe gets one prefix and one wording everywhere, and a bare
`typeof x` guard of that kind carries the same comment even where no rule
reports it.

The [typed features
heuristic](https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/heuristics/typed-features.md)
maps each finding and keyword to its fix.
