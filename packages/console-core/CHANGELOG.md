# Changelog

## Unreleased

- The console resources' validation feedback names the catalog key `jskit.console.feedback.validationFailed` instead of plain English; JSKIT's forms render it with `text()`, so the English shown is unchanged. `apiValidation` is sent in the coded form with `validation_failed`.

### New message keys (1)

<details><summary>Key list</summary>

- `jskit.console.feedback.validationFailed`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (3)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.console.owner.invalidUser`
- `jskit.console.owner.authenticationRequired`
- `jskit.console.owner.forbidden`

</details>

### Codes (3)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `console.owner.invalidUser` | Invalid console user. |
| `console.owner.authenticationRequired` | Authentication required. |
| `console.owner.forbidden` | Forbidden. |
