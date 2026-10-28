# Changelog

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
