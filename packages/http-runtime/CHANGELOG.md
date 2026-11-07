# Changelog

## Unreleased

- `withStandardErrorResponses` and `withJsonApiErrorResponses` give every route the same error response schemas, frozen all the way down, instead of building new ones for each route, so the kernel strips, copies and keys each of them once per server. `JSON_API_ERROR_DOCUMENT_SCHEMA` is frozen all the way down.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Error responses include `params`, `messageCode` and `messageParams`; JSON:API `errors[].meta` carries them and the field-error code.
- A request body that fails its schema outside JSON:API returns `validation_failed` with `details.fieldErrors` and `details.fieldErrorCodes`.

### New message keys (4)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.http.request.failedWithStatus`
- `jskit.http.request.networkFailed`
- `jskit.errors.jsonapi_request_body_invalid`
- `jskit.errors.jsonapi_request_type_mismatch`

</details>

### Codes (4)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `http.request.failedWithStatus` | Request failed with status {status}. |
| `http.request.networkFailed` | Network request failed. |
| `jsonapi_request_body_invalid` | JSON:API request body must contain a resource document. |
| `jsonapi_request_type_mismatch` | JSON:API resource type must be {type}. |
