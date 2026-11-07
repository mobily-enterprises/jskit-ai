# Changelog

## Unreleased

- Routes share a response schema that is plain JSON, frozen all the way down and names every node's type, instead of each route getting its own copy, and `createCachedResponseSerializerFactory` keys such a schema once instead of checking it again for every route and status. In a CompAS boot the 3,562 error-response compilations went from 2,396 schema objects to 4, and keying them from 72-84 ms to about 1 ms. A frozen schema that Fastify's own serializer would add a `type` to is still copied for each route.
- `createCachedResponseSerializerFactory` compiles each response serializer when a response first uses it, in every environment, instead of compiling every route's response schemas at startup. Measured on CompAS (203 distinct response schemas, desktop): a boot built 203 serializers in 0.9-1.1 s and now builds none, while the checks below take 55-96 ms (meta-schema 37-73 ms, references 18-23 ms); BeePollen built 66 in 0.24-0.27 s. Startup still runs fast-json-stringify's own checks of each schema before it would build: the JSON Schema draft-07 meta-schema check (for the external schemas too) and a check that every `$ref` the schema reaches resolves (a schema whose reference does not resolve is compiled at once, so the build's own error stops startup). What startup no longer catches: errors fast-json-stringify finds only while generating a serializer, and an invalid serializer option (`rounding`, say); they fail the first response that uses the schema, and its next use tries again. A serializer is built from the schema as it was registered. The factory now depends directly on `fast-json-stringify` and `json-schema-ref-resolver` (already installed with Fastify), loaded with the first factory, so importing `@jskit-ai/kernel/server/http` still loads neither.
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
- The client address is Fastify's `request.ip`; behind a reverse proxy, create Fastify with `trustProxy` set to the proxy's address, or every client shares the proxy's count. A Fastify test stub serving routes that declare a limit needs an `async register() {}`.

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
