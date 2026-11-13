# Changelog

## Unreleased

- `request(url, { response: "file" })` answers a download as `{ blob, fileName, contentType }`: the body as a Blob, the name its `Content-Disposition` gives (the RFC 5987 `filename*` before the plain `filename`, as RFC 6266 asks; null when it names none) and its content type. A refusal is read and thrown as for any request, so a step-up or validation refusal reaches the caller's usual handling. Any other `response` value, and `response: "file"` on `requestStream()`, is refused. Before, the client read a body that was not JSON as `{}`, so a page could not download a file through it and keep its credentials, CSRF token and refusal handling.
- The JSON:API route transport's error document takes the transaction outcome the kernel's error handler passes it (`transactionOutcome`, the wrapper's when the handler answers a refusal a json-rest-api write wrapped), and otherwise the error's own, so a CRUD route's refusal keeps `meta.transactionOutcome`.
- `simplifyJsonApiResult(result, { lookupFieldMap })` and `simplifyJsonApiDocument(document, { lookupFieldMap })` take the field key of a to-one relationship whose key is not its name plus `Id` (`{ owner: "ownerUserId" }`), so a decorated CRUD service reads the record it wrote from its own answer, with its real field keys, instead of reading it again.
- `createTransientRetryHttpClient` marks a `GET`/`HEAD` transient failure whose retries it spent (kernel `markTransientRetriesSpent`), so the app QueryClient's `shouldRetryTransientQueryFailure` does not retry the whole retried call again: one unreachable read is 3 requests and 3 s to the recovery banner instead of 9 requests and 11 s. Which requests it retries, how often and when are unchanged.
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
