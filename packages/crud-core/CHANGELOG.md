# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (9)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.INVALID_CURSOR`
- `jskit.crud.record.notFound`
- `jskit.crud.document.notFound`
- `jskit.crud.fieldAccess.writeDenied`
- `jskit.crud.query.includeInvalid`
- `jskit.crud.query.fieldsInvalid`
- `jskit.crud.query.fieldsByTypeInvalid`
- `jskit.crud.query.fieldsKeysInvalid`
- `jskit.crud.query.fieldsKeysInvalidWithAliases`

</details>

### Codes (9)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `INVALID_CURSOR` | Invalid cursor. |
| `crud.record.notFound` | Record not found. |
| `crud.document.notFound` | Document not found. |
| `crud.fieldAccess.writeDenied` | Write access denied for fields: {fields}. |
| `crud.query.includeInvalid` | include expects a comma-separated string such as "{example}". |
| `crud.query.fieldsInvalid` | fields expects an object such as {example}. |
| `crud.query.fieldsByTypeInvalid` | fields expects an object keyed by JSON:API resource type, such as {example}. |
| `crud.query.fieldsKeysInvalid` | fields keys must be JSON:API resource types. Allowed keys: {allowedTypes}. |
| `crud.query.fieldsKeysInvalidWithAliases` | fields keys must be JSON:API resource types. Allowed keys: {allowedTypes}. Relationship aliases are invalid keys; {aliasGuidance}. |
