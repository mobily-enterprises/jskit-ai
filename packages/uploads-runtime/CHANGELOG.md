# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (7)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.uploads.file.invalid`
- `jskit.uploads.file.tooLarge`
- `jskit.uploads.file.empty`
- `jskit.uploads.file.typeNotAllowed`
- `jskit.uploads.file.tooMany`
- `jskit.uploads.file.required`
- `jskit.uploads.file.fieldNotAllowed`

</details>

### Codes (7)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `uploads.file.invalid` | Upload is invalid. |
| `uploads.file.tooLarge` | {label} file is too large. Maximum allowed size is {maxMb}MB. |
| `uploads.file.empty` | {label} file is empty. |
| `uploads.file.typeNotAllowed` | {label} must be one of: {types}. |
| `uploads.file.tooMany` | {label} upload allows only one file. |
| `uploads.file.required` | {label} file is required. |
| `uploads.file.fieldNotAllowed` | {label} field "{field}" is not allowed. |
