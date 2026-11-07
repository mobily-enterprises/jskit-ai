# Changelog

## Unreleased

- Depends on json-rest-api 2.4.0 (from 2.1.0). Every-row reads now get their 1,000-row pages (480 rows: 3 statements and 3 policy runs instead of 15 and 15 in JSKIT's measurement fixture); writes skip the post-write refresh nothing observes (a created child: 9 statements and 5 policy runs instead of 11 and 7); linkage checks run one query per type; reads copy records for `originalRecord` only for hooks that can read it (a query of 100 rows of 38 KB: about a third of the CPU). Also from 2.2.0-2.3.1: `aggregate()`, `email` and `uuid` field types, `retired: true` fields, AnyAPI indexed slots, and relationship targets locked FOR SHARE instead of FOR UPDATE.
- New `queryAllJsonRestCollectionDocument(resource, params, context)`: every row a query matches as one JSON:API document `{ data, included }`, with each page's included records kept once, for server reads that use `include`. CRUD repositories' `queryEveryDocument` reads through it.
- `queryAllJsonRestCollectionRows` asks for 1,000-row pages (or the resource's `queryMaxLimit` when larger) through json-rest-api's server-only `pageSizeLimit`, so an every-row read pays each page's row policy and linkage queries once per 1,000 rows instead of once per 100: 480 rows read in 3 statements instead of 15. json-rest-api before 2.4.0 ignores `pageSizeLimit` and keeps 100-row pages; the result is the same rows either way. HTTP page sizes are unchanged.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (2)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.REST_API_VERSION_CONFLICT`
- `jskit.errors.REST_API_PRECONDITION_FAILED`

</details>
