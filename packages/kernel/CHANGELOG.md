# Changelog

## Unreleased

- A feature that owns resources hands its dependencies (its `requires` and the optional capabilities present, by local name, as setup receives them) to the resource runtime's `own(featureId, owns, { requires })`, so each `owns` entry's `rowPolicy` receives them as `requires`. The `ResourceRuntime` type's `own` takes that third argument.
- A package manifest (`jskit.capabilities`) names a capability id in any case, as a provider does: the start-up check of a package's manifest against its server providers, and the check that every installed package's requirement has a provider, compare manifest ids trimmed and lower-cased with `capabilityKey`, as the capability runtime resolves provider ids. They only trimmed them, so a manifest listing a mixed-case id such as `assistant.personContext` stopped start-up with "manifest provides [assistant.personContext] but its providers provide [assistant.personcontext]", and a manifest requiring an id in another case than the manifest providing it was refused as having no provider.
- `request.callOptions({ input })` gives a route that runs no action (a provider's callback, a streamed download) the call options `{ context }` the same request's action would get: the action catalogue's new `contextFor({ input, context })` runs the same context contributors and normalizes the result as the action pipeline does, with the route's channel, surface, visibility and request, and `input` defaulting to the route's params, so the workspace is resolved from `workspaceSlug` as an action's is. Contributors are told no action, and no action permission is checked: the route's own `auth` and `permission` are its gate.
- **Security.** `defineFeature` refuses `runtime.resources` in `requires` or `optional` in any spelling the runtime resolves, such as `"Runtime.Resources"` or `" runtime.resources "`: capability ids are trimmed and lower-cased when they resolve, but the refusal compared the raw text, so another spelling handed a feature the whole resource runtime, whose `declareSystemScope` mints a system context.
- The action catalogue builds its registry once, when discovery or execution first reads it, instead of again at every registration: an app registering n contributors rebuilt its index n times at every composition. A contributor that repeats a registered action's id and version is still refused at its own registration, with the same message. An action input whose schema is frozen throughout, as a CRUD feature's are, is checked for `oneOf` once rather than at every registration of it; a schema that can still change is checked every time, as before.
- An action event whose scope is global (one written on a customer's or a public surface) carries the workspace the request resolved as its scope's `workspaceId`: the context's workspace, the resolved workspace context's, or the request's, when they agree, never one its input or payload names. Realtime reads the event's audience there, in place of a `workspaceId` the payload named.
- A database error never reaches a client. A driver's error carries the statement and its values (Knex starts its message with the SQL and its bindings; MySQL's `sqlMessage` and `sql`, Postgres's `detail`), and a wrapper that keeps one as its `cause`, such as json-rest-api's `RestApiWriteError`, copies its message and code. The HTTP error handler answered it 500 with the driver's code (`ER_CHECKREAD`, `ER_DUP_ENTRY`, `23505`). It now answers a stand-in: 409 with the code `kernel.database.concurrentWrite` ("Another request changed the same data at the same time. Try again.") when the database refused the transaction for a concurrent one (MySQL and MariaDB errno 1020 "Record has changed since last read", 1213 deadlock, 1205 lock wait timeout; Postgres `40001`, `40P01`, `55P03`; `SQLITE_BUSY`), so the client may send the request again, else 500 `internal_server_error`, with the wrapper's `transactionOutcome`; the whole error goes to the log as "Database error". An `AppError` keeps its own answer whatever it wraps, so a duplicate key a feature turns into a `ConflictError` answers as before. `hideDatabaseError(error)` (`@jskit-ai/kernel/server/runtime`) answers the stand-in, or the error itself when it is not a database error, for any other edge that answers a client. New message key: `jskit.kernel.database.concurrentWrite`.
- An action a system context or a job runs keeps that context's kind: `normalizeExecutionContext` now passes a context's symbol-keyed entries through with the rest, so the private markers of a json-rest-api system context and of a job context derived from one reach the action, and a handle call inside it reads as that system context or job, not as an anonymous request. The reserved fields are normalized as before, and a job done for one person is still signed in as no one: `actor` stays null, so an authenticated action and `requireAuth` refuse it.
- `resolveTrustedProxies(env)` (`@jskit-ai/kernel/server/http`) gives Fastify's `trustProxy` from one setting, `TRUSTED_PROXIES`: the addresses or ranges of the proxies in front of the server, comma-separated, in Fastify's `trustProxy` (proxy-addr) syntax, such as `TRUSTED_PROXIES=loopback,10.0.0.5` or `10.0.0.0/24`. Without it only `loopback` is believed. `true` and hop counts stop startup with a message saying why, because they believe an `X-Forwarded-For` any client can send. The foundations' `server.js` creates Fastify with `trustProxy: resolveTrustedProxies(runtimeEnv)`, so behind a named proxy `request.ip`, and every route rate limit and sign-in limit counted by it, is each client's own address; before, a server created with no `trustProxy` counted every client behind a proxy as the proxy, one shared limit for all. A client that sends `X-Forwarded-For` itself, directly or prepended through the proxy, still counts as the address the server or the proxy saw.
- `resolveClientIpAddress(request)` (`@jskit-ai/kernel/server/runtime/requestUrl`) is `request.ip`. It read the first `X-Forwarded-For` entry from any request, so a client could set the address it recorded; it now follows `TRUSTED_PROXIES` like the rest of the server.
- `shellScrollBehavior` waits for the page to draw a position it restores (Back/Forward's saved position, or the `state.restoreScroll` of shell-web's Up) and a hash target. vue-router calls it once the new route has rendered, before a page has drawn the content it loads, so a list still fetching its rows was too short: the position landed at the page's end (usually its top) and a hash target not drawn yet was skipped. It now answers with a promise when the page cannot reach the position yet, checks on every frame, and scrolls once the page is tall enough or the target exists, or after 1.5 s (as long as shell-web's Up waits to focus the record it opened) as far as the page goes; it does not scroll when the person wheels, touches, presses a key or clicks meanwhile. A position the page already reaches, and a new screen's top, scroll at once as before.
- `@jskit-ai/kernel/server/actions/actionContributorHelpers` exports `resolveAuditActorId(context, request)`, the user a write is made for, for audit fields: the signed-in user, else `context.onBehalfOf.id`, the user background work acts for. It never decides access; `resolveActor`, `resolveActorId` and every authentication check ignore `onBehalfOf`, so work done for someone is not signed in as them.
- `shouldRetryTransientQueryFailure` no longer retries a query whose request the transport already retried for a transient failure, so each failed request is retried by one layer. The HTTP client marks such an error with the new `markTransientRetriesSpent`. Before, a failed safe read was retried by the HTTP client (three attempts) and the whole retried call again by the query (three times), so one unreachable read made 9 requests and showed shell-web's recovery banner after 11 s; it now makes 3 and shows it after 3 s. Queries whose requests the client does not retry (other methods, custom fetches) keep their two transient retries.
- A provider or feature may give `hints`, keyed by the capability ids it requires, saying what to register when one is missing; the startup error "requires missing capability" adds it. A hint must name a required capability and be non-empty text. A feature that owns tables or declares a system scope hints that `runtime.resources` comes from `@jskit-ai/resource-runtime`.
- Routes share a response schema that is plain JSON, frozen all the way down and names every node's type, instead of each route getting its own copy, and `createCachedResponseSerializerFactory` keys such a schema once instead of checking it again for every route and status. In a large application's boot the 3,562 error-response compilations went from 2,396 schema objects to 4, and keying them from 72-84 ms to about 1 ms. A frozen schema that Fastify's own serializer would add a `type` to is still copied for each route.
- An event builder from `createEntityChangedActionEvent` carries the realtime part it was declared with as its `realtime` property (null without one), so realtime can check a declared audience when it boots.
- `tryAcquireExclusiveFileLock` runs one short `flock` process per acquisition and none while the lock is held, instead of a shell that stayed alive holding the lock and a `flock` it started. The lock always belonged to the caller's open file description, so it is still released when the handle closes or the process ends however it ends, and it still excludes `flock` on the same file from any other process. Release only closes the handle; it no longer waits for a holder process to exit. A `flock` failure other than a held lock is now an error instead of being reported as busy.
- `bootstrapClientShellApp` starts downloading the code of the page the tab opened on before it boots the client modules, so it arrives while they boot (shell-web's bootstrap and session requests among them) instead of after them and the router's guards. It calls the lazy component loaders of the route the address matches; the router later calls the same loaders and gets the modules from the browser's module map, and still reports a loader that fails. A guard that redirects, such as a signed-out visit to a signed-in page, leaves the download unused, and an address that matches only the fallback route, or a route the client modules add, is left to the router. Measured on the accounts starter with 60 ms of latency per request: the home page's code was requested at 704 ms instead of 1,082 ms, during the shell's requests instead of after the session, and its last request ended at 992 ms instead of 1,217 ms; cold loads showed the signed-in home page in 1,110 ms instead of 1,286 ms and the account settings page, whose code now loads with its route, in 1,265 ms instead of 1,612 ms.
- The client bootstrap imports a package's client providers through the subpath exports that name their files, instead of `import * as` its whole `./client`, whenever the providers are all it reads there: the package declares no UI routes, its `./client` file declares neither `routeComponents` nor `clientRoutes` and has no `export *`, and each provider's file has a subpath export of its own. The screens `./client` re-exports, and their libraries, then load with the routes that show them instead of on every page of every app. Measured on the accounts starter (users-web 0.2.21, whose `./client` re-exports the account settings screen): the JavaScript a page loads before it starts went from 1,302 KB (415 KB gzip) to 778 KB (259 KB gzip) and its stylesheets from 474 KB to 347 KB, and Uppy, cropperjs, exifr and compressorjs are no longer among them; with 60 ms of latency per request, a cold signed-in home page showed in 1,286 ms instead of 1,681 ms and the sign-in screen in 1,354 ms instead of 1,601 ms. Code at the top level of such a `./client` no longer runs at boot; JSKIT's packages register their messages through the bootstrap's catalogs, which still load. Development prebundles a provider subpath with its package's `./client`, and keeps it as source when the package excludes `./client` from `optimizeDeps`, as shell-web does. A package gets this by exporting each provider by its own subpath (the client guide's Provider subpaths rule), and `tooling/jskit-catalog/test/clientBootGraph.test.js` fails when a page of an app that installs every JSKIT client package would load any library beyond the bootstrap's own.
- `createCachedResponseSerializerFactory` compiles each response serializer when a response first uses it, in every environment, instead of compiling every route's response schemas at startup. Measured on a large application (203 distinct response schemas, desktop): a boot built 203 serializers in 0.9-1.1 s and now builds none, while the checks below take 55-96 ms (meta-schema 37-73 ms, references 18-23 ms); a smaller application built 66 in 0.24-0.27 s. Startup still runs fast-json-stringify's own checks of each schema before it would build: the JSON Schema draft-07 meta-schema check (for the external schemas too) and a check that every `$ref` the schema reaches resolves (a schema whose reference does not resolve is compiled at once, so the build's own error stops startup). What startup no longer catches: errors fast-json-stringify finds only while generating a serializer, and an invalid serializer option (`rounding`, say); they fail the first response that uses the schema, and its next use tries again. A serializer is built from the schema as it was registered. The factory now depends directly on `fast-json-stringify` and `json-schema-ref-resolver` (already installed with Fastify), loaded with the first factory, so importing `@jskit-ai/kernel/server/http` still loads neither.
- A feature can own tables and work across every workspace (data-access redesign). `defineFeature({ owns, systemScope })`:
  - `owns: [tableResource | { resource, ...serverOnlyExtras }]` makes the feature its tables' one owner. The kernel calls the `runtime.resources` capability's `own(featureId, owns)` before `setup`, and `setup` alone receives the handles as `resources`, by resource name; `actions()`, `boot` and `shutdown` do not.
  - `systemScope: "<why>"` gives `setup` a `systemContext(reason)` factory. Every call names its reason and throws without one; the factory comes from `runtime.resources.declareSystemScope(featureId, systemScope)`.
  - Either one makes the feature require `runtime.resources`; a feature without them does not. A feature may not require `runtime.resources` itself, and the local names `resourceRuntime`, `resources` and `systemContext` are reserved beside `actionCatalogue`.
  - The `ResourceRuntime` type in `@jskit-ai/kernel/server/types` is the contract a resource runtime provides.
- Routes that validate the same body, query, params or headers hand Fastify one shared, frozen schema object, so its Ajv compiles each distinct schema once per server instead of once per route: an app with 96 route validation schemas, 22 of them distinct, now compiles 22 (Ajv time per boot 644 ms -> 302 ms on a loaded host). A route's validation schema can no longer be changed after it is registered (in an `onRoute` hook, say), since routes share it.
- A process discovers an app's installed packages once instead of on every boot and every database preparation, and the first discovery probes the file system about half as often. `discoverInstalledPackages`, which `createInstalledRuntime`, database-runtime's migration configuration and the Vite client bootstrap call, reads the manifest of every installed package, npm's own included. It now keeps an app's result while npm's `node_modules/.package-lock.json` (rewritten by every install), the app's `package.json` and its local packages' manifests keep their size and modification time, so a second server boot or database preparation in one process, such as a test file's, reads no manifest; a change to any of those files is seen by the next call. A `node_modules` without that file (another package manager, one written by hand) is discovered afresh on every call, as before. The walk no longer checks a package's directory and manifest again after finding it, nor looks for `node_modules` inside a `node_modules` directory, which Node never does. Measured on an app with 446 installed packages: 3191 existence checks per discovery became 1663 and 0.5-1.0 s of CPU became 0.36 s; a repeated discovery takes under a millisecond (11 `stat` calls). The discovered entries are now frozen throughout, `packageMetadata` and `packageJson` included, since callers share them.
- `staysOnSamePage(to, from)`, and so `shellScrollBehavior`, counts a shared parent record as one page only when it draws a component: a layout hosting tabs or sub-views. The component-less records file routing creates for route folders (`/w`, `bookings/`) no longer make every page in the folder the same page, so a new page in a folder opens at the top instead of at the last page's scroll, and Up's `state.restoreScroll` is used instead of ignored. Tabs of a layout still keep their scroll.
- Production builds keep Vuetify's cascade layer order. A build links its shared component chunks' stylesheets, each opening with `@layer vuetify-components`, before the entry's `vuetify/styles`, which named that layer before `vuetify-core`: Vuetify's reset (`button, input, select, textarea { font: inherit }`) then beat its component styles, and every `<button>` `v-btn` showed a 16px/400 label instead of label-large. `createJskitClientBootstrapPlugin` now puts Vuetify's layer order (its `layers.css`) in a `<style>` first in every page's `<head>`, built or in development; apps need no change to their `index.html`. A production build also checks its own output: when a page's stylesheets, in page order and then those it loads later, would put Vuetify's layers in any other order (a layer a newer Vuetify adds included), the build fails and names both orders.
- `createShellRouter` throws when the `createRouter` it is given replaces the scroll behaviour it passes (a wrapper with a `scrollBehavior` of its own), instead of silently losing `shellScrollBehavior` and with it the position Up returns to. An app's own behaviour is `createShellRouter`'s `scrollBehavior` option, which may call `shellScrollBehavior`; `false` still leaves scrolling to the browser. Upgrading: move a wrapper's `scrollBehavior` into that option.
- `shellScrollBehavior` opens a hash target below its computed `scroll-margin-top`, as the browser's own scroll to an element does, so a target with a margin for a sticky bar stays clear of it without wrapping the behaviour.
- `shellScrollBehavior` opens a page at the position a navigation carries in `state.restoreScroll`, as shell-web's Up does when it returns to a page, and the client exports `staysOnSamePage(to, from)`, the check it uses for tabs and sub-views of one page.
- `createInstalledRuntime` adds security headers to every response its Fastify server sends: `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` always, and in production (`NODE_ENV=production`) `Strict-Transport-Security: max-age=31536000`, `Content-Security-Policy: frame-ancestors 'self'` and a report-only content policy that JSKIT's client runs under. `config.securityHeaders` changes or switches each one off; a route's own header wins. `registerSecurityHeaders` (`@jskit-ai/kernel/server/http`) does the same for a server composed without `createInstalledRuntime`.
- `createInstalledRuntime` returns `health`, whose `check()` runs the checks providers register through the optional `runtime.health` capability, each within two seconds, and reports `{ ok, checks }` without error details.
- `@jskit-ai/kernel/server/runtime/runtimeMode` exports `isProductionEnv(env)`, the one check JSKIT packages make to decide production, the security headers included: `NODE_ENV` is `production`, in any letter case; anything else, unset included, is development, as before. It also exports `assertDevelopmentOnlySettings(env, names)`, which stops a production server's startup when any of the named development-only settings is set, saying which to remove.
- A route's `rateLimit: { max, timeWindow }` is enforced. The kernel registers `@fastify/rate-limit` (now its dependency) before the routes whenever one declares a limit, counts each client address on each limited route, and refuses a request over the limit with status 429, the code `kernel.http.rateLimited` (`params.count` is the seconds to wait) and a `Retry-After` header. Before, the router dropped `rateLimit`, so no declared limit applied. A malformed `rateLimit`, or one given as `config.rateLimit`, stops the route's definition. New message key: `jskit.kernel.http.rateLimited`.
- A package's route (`jskit.metadata.ui.routes`, or a client module's `clientRoutes`) no longer copies its `surface` into `meta.jskit`, where `surface` marks a surface's root record. The shell's Up stops at such a record before reading its parent, so every surface route a package declared was a surface root with no Up, and the `meta.jskit.parent` it declared was never read. The route keeps `surface` as its own field, which still chooses where it is served; `meta.jskit.surface` is now only what the route's meta declares. Upgrading: a package route that relied on that copy to be a top-level root declares no parent, as a top-level page does.
- An array field's `minItems` and `maxItems` (json-rest-schema 1.0.18) failures carry their field codes, `kernel.validation.field.minItems` ("Must have at least {min} items.") and `kernel.validation.field.maxItems` ("Must have no more than {max} items."), with the library's `{ min | max, actual }` params; a field's `messages.minItems` and `messages.maxItems` override their English. Before, they reached the form as English without a code. New message keys: `jskit.kernel.validation.field.minItems`, `jskit.kernel.validation.field.maxItems`.
- An action's input refuses a field, at any depth, that declares `oneOf`, when the action is defined (and when a policy returns its input): json-rest-schema validates no `oneOf`, so a field listing its allowed values with it accepted any value. The error names the field and `enum`, which does restrict the value. A resource's `searchSchema` keeps `oneOf` for the fields a search matches; action outputs are not checked.

### Upgrading

- A production server that another site frames, such as an editor's preview of a production build, lists that site in `config.securityHeaders.frameAncestors`.
- Move `/api/health` after `createInstalledRuntime` and answer `503` when `runtime.health.check()` is not ok, as the foundations do.
- An action input field that lists its allowed values with `oneOf: [...]` now stops the action's definition; write `enum: [...]` instead, and its value is checked.
- The client address is Fastify's `request.ip`. Add `trustProxy: resolveTrustedProxies(runtimeEnv)` to the `Fastify({ ... })` call in the app's `server.js` (import `resolveTrustedProxies` from `@jskit-ai/kernel/server/http`), as the foundations do, and set `TRUSTED_PROXIES` to the proxies in front of a production server, the narrowest addresses or ranges that are only those proxies (a private range shared with other machines lets each of them choose its address). An app with its own proxy setting deletes it: its environment variable, the code that turned it into `trustProxy`, and any `trustProxy: true` or hop count, which now stop startup if moved into `TRUSTED_PROXIES`. A Fastify test stub serving routes that declare a limit needs an `async register() {}`.

- `createServerI18n()` also returns `resolveLocale(preferences)`: from a person's preferred locales (most preferred first, such as `ui_locales` or `Accept-Language`) the first the app has translations for, exactly or by language, else `en`.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- `AppError` takes `{ code, params, messageCode, messageParams }`; every error response carries `code` and `params` next to the English `message`.
- `createValidationError` accepts `{ field: { code, params, message } }`; responses keep `details.fieldErrors` (English) and add `details.fieldErrorCodes`.
- Request validation maps Fastify/Ajv issues to `kernel.validation.*` field codes; resource-schema messages may be `{ code, message, params }`.
- Client: `useJskitText()` (`t`, `text`, `serverMessage`, `fieldErrorMessages`, Intl formatting helpers), `createTextError`, `registerJskitMessages`, and `bootstrapClientShellApp({ i18n })` for the app's composition-mode vue-i18n instance (optional peer dependency `vue-i18n`).
- Server: `createServerI18n({ appRoot, catalogs })` renders messages in a recipient's language from the app's `src/locales/<code>/jskit.json`.
- Shared: `formatMessage`, `catalogMessage`, `mergeCatalogs`, `flattenCatalog`, `messageKeyForCode`, `messageParams`.
- `serverMessage(source, fallback)` returns the fallback when the source has no message, as `message || fallback` did.

### Upgrading

- Apps translate nothing until they pass a vue-i18n instance; screens and texts stay as they were.
- Tests that compare whole error payloads exactly: every error response now has `params` (often `{}`), and some have `messageCode`/`messageParams` (a hidden 5xx answer carries `messageCode: "internal_server_error"`). Match the fields you need instead.
- Tests or code that expect `APP_ERROR` for a JSKIT error: errors that used to fall back to `APP_ERROR` now have their own dotted codes (listed in each package's Codes table), and `createValidationError` answers `validation_failed`. Codes that already existed keep their values.
- A plain-JSON (non-JSON:API) request body that fails its schema now answers `validation_failed` with `details.fieldErrors`, instead of `request_failed`, so JSKIT forms show the error next to the field.

### New message keys (74)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.internal_server_error`
- `jskit.errors.request_failed`
- `jskit.errors.validation_failed`
- `jskit.errors.FST_ERR_VALIDATION`
- `jskit.errors.not_found`
- `jskit.errors.conflict`
- `jskit.errors.domain_validation_failed`
- `jskit.errors.AUTHENTICATION_REQUIRED`
- `jskit.errors.PERMISSION_DENIED`
- `jskit.errors.ACTION_AUTHENTICATION_REQUIRED`
- `jskit.errors.ACTION_CHANNEL_FORBIDDEN`
- `jskit.errors.ACTION_PERMISSION_DENIED`
- `jskit.errors.ACTION_SURFACE_FORBIDDEN`
- `jskit.errors.ACTION_NOT_FOUND`
- `jskit.errors.ACTION_VALIDATION_FAILED`
- `jskit.errors.ACTION_IDEMPOTENCY_KEY_REQUIRED`
- `jskit.errors.ACTION_ID_REQUIRED`
- `jskit.errors.ACTION_STREAM_KIND_REQUIRED`
- `jskit.errors.ACTION_VERSION_INVALID`
- `jskit.errors.ACTION_OUTPUT_VALIDATION_FAILED`
- `jskit.errors.unsupported_media_type`
- `jskit.kernel.validation.required`
- `jskit.kernel.validation.type`
- `jskit.kernel.validation.minLength`
- `jskit.kernel.validation.maxLength`
- `jskit.kernel.validation.minimum`
- `jskit.kernel.validation.maximum`
- `jskit.kernel.validation.exclusiveMinimum`
- `jskit.kernel.validation.exclusiveMaximum`
- `jskit.kernel.validation.multipleOf`
- `jskit.kernel.validation.pattern`
- `jskit.kernel.validation.format`
- `jskit.kernel.validation.enum`
- `jskit.kernel.validation.const`
- `jskit.kernel.validation.minItems`
- `jskit.kernel.validation.maxItems`
- `jskit.kernel.validation.additionalItems`
- `jskit.kernel.validation.uniqueItems`
- `jskit.kernel.validation.minProperties`
- `jskit.kernel.validation.maxProperties`
- `jskit.kernel.validation.additionalProperties`
- `jskit.kernel.validation.propertyNames`
- `jskit.kernel.validation.oneOf`
- `jskit.kernel.validation.anyOf`
- `jskit.kernel.validation.not`
- `jskit.kernel.validation.if`
- `jskit.kernel.validation.invalid`
- `jskit.kernel.validation.schemaFailed`
- `jskit.kernel.validation.recordIdInvalid`
- `jskit.kernel.validation.field.required`
- `jskit.kernel.validation.field.typeCastFailed`
- `jskit.kernel.validation.field.notNullable`
- `jskit.kernel.validation.field.minLength`
- `jskit.kernel.validation.field.maxLength`
- `jskit.kernel.validation.field.minValue`
- `jskit.kernel.validation.field.maxValue`
- `jskit.kernel.validation.field.pattern`
- `jskit.kernel.validation.field.enumValue`
- `jskit.kernel.validation.field.notAllowed`
- `jskit.kernel.validation.field.strictBoolean`
- `jskit.kernel.validation.field.rangeExceeded`
- `jskit.kernel.validation.field.notEmpty`
- `jskit.kernel.action.versionInvalid`
- `jskit.kernel.action.idRequired`
- `jskit.kernel.action.idempotencyKeyRequired`
- `jskit.kernel.route.handlerUnavailable`
- `jskit.kernel.surface.pathNotServed`
- `jskit.kernel.moduleLoad.appModuleNotDownloaded`
- `jskit.kernel.moduleLoad.appModuleFailed`
- `jskit.kernel.moduleLoad.pageNotDownloaded`
- `jskit.kernel.moduleLoad.pageFailed`
- `jskit.kernel.moduleLoad.notDownloaded`
- `jskit.kernel.moduleLoad.failed`
- `jskit.kernel.moduleLoad.reloadUnavailable`

</details>

### Codes (73)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `internal_server_error` | Internal server error. |
| `request_failed` | Request failed. |
| `validation_failed` | Validation failed. |
| `not_found` | Not found. |
| `conflict` | Conflict. |
| `domain_validation_failed` | Domain validation failed. |
| `AUTHENTICATION_REQUIRED` | Authentication required. |
| `PERMISSION_DENIED` | Forbidden. |
| `ACTION_AUTHENTICATION_REQUIRED` | Authentication required. |
| `ACTION_CHANNEL_FORBIDDEN` | Forbidden. |
| `ACTION_PERMISSION_DENIED` | Forbidden. |
| `ACTION_SURFACE_FORBIDDEN` | Forbidden. |
| `ACTION_NOT_FOUND` | Not found. |
| `ACTION_VALIDATION_FAILED` | Validation failed. |
| `ACTION_IDEMPOTENCY_KEY_REQUIRED` | Validation failed. |
| `ACTION_ID_REQUIRED` | Validation failed. |
| `ACTION_STREAM_KIND_REQUIRED` | Validation failed. |
| `ACTION_VERSION_INVALID` | Validation failed. |
| `ACTION_OUTPUT_VALIDATION_FAILED` | Action output validation failed. |
| `unsupported_media_type` | Content-Type must be {contentType}. |
| `kernel.validation.required` | must have required property '{missingProperty}' |
| `kernel.validation.type` | must be {type} |
| `kernel.validation.minLength` | must NOT have fewer than {limit} characters |
| `kernel.validation.maxLength` | must NOT have more than {limit} characters |
| `kernel.validation.minimum` | must be >= {limit} |
| `kernel.validation.maximum` | must be <= {limit} |
| `kernel.validation.exclusiveMinimum` | must be > {limit} |
| `kernel.validation.exclusiveMaximum` | must be < {limit} |
| `kernel.validation.multipleOf` | must be multiple of {multipleOf} |
| `kernel.validation.pattern` | must match pattern "{pattern}" |
| `kernel.validation.format` | must match format "{format}" |
| `kernel.validation.enum` | must be equal to one of the allowed values |
| `kernel.validation.const` | must be equal to constant |
| `kernel.validation.minItems` | must NOT have fewer than {limit} items |
| `kernel.validation.maxItems` | must NOT have more than {limit} items |
| `kernel.validation.additionalItems` | must NOT have more than {limit} items |
| `kernel.validation.uniqueItems` | must NOT have duplicate items (items ## {j} and {i} are identical) |
| `kernel.validation.minProperties` | must NOT have fewer than {limit} properties |
| `kernel.validation.maxProperties` | must NOT have more than {limit} properties |
| `kernel.validation.additionalProperties` | must NOT have additional properties |
| `kernel.validation.propertyNames` | property name must be valid |
| `kernel.validation.oneOf` | must match exactly one schema in oneOf |
| `kernel.validation.anyOf` | must match a schema in anyOf |
| `kernel.validation.not` | must NOT be valid |
| `kernel.validation.if` | must match "{failingKeyword}" schema |
| `kernel.validation.invalid` | Invalid value. |
| `kernel.validation.schemaFailed` | Schema validation failed. |
| `kernel.validation.recordIdInvalid` | Record id must be a canonical positive integer string. |
| `kernel.validation.field.required` | Field is required |
| `kernel.validation.field.typeCastFailed` | Value could not be cast to the required type. |
| `kernel.validation.field.notNullable` | Field cannot be null |
| `kernel.validation.field.minLength` | Length must be at least {min} characters. |
| `kernel.validation.field.maxLength` | Length must be no more than {max} characters. |
| `kernel.validation.field.minValue` | Value must be at least {min}. |
| `kernel.validation.field.maxValue` | Value must be no more than {max}. |
| `kernel.validation.field.pattern` | Value does not match the required pattern. |
| `kernel.validation.field.enumValue` | Value must match one of the allowed enum values. |
| `kernel.validation.field.notAllowed` | Field not allowed |
| `kernel.validation.field.strictBoolean` | Value must be a boolean. |
| `kernel.validation.field.rangeExceeded` | Numeric value is out of the allowed character range. |
| `kernel.validation.field.notEmpty` | Field cannot be empty. |
| `kernel.action.versionInvalid` | version must be an integer >= 1. |
| `kernel.action.idRequired` | actionId is required. |
| `kernel.action.idempotencyKeyRequired` | Idempotency key is required for this action. |
| `kernel.route.handlerUnavailable` | Route handler is not available in this runtime profile. |
| `kernel.surface.pathNotServed` | Path {path} is not served by {surface} surface server. |
| `kernel.moduleLoad.appModuleNotDownloaded` | App module did not download. The app may have been updated, or the network request failed. |
| `kernel.moduleLoad.appModuleFailed` | App module could not load. |
| `kernel.moduleLoad.pageNotDownloaded` | Page did not download. The app may have been updated, or the network request failed. |
| `kernel.moduleLoad.pageFailed` | Page could not load. |
| `kernel.moduleLoad.notDownloaded` | {label} did not download. The app may have been updated, or the network request failed. |
| `kernel.moduleLoad.failed` | {label} could not load. |
| `kernel.moduleLoad.reloadUnavailable` | The app cannot reload because the app server is not reachable. Restart the server, then click Retry or Reload. |
