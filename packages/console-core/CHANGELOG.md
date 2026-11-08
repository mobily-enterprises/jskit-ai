# Changelog

## Unreleased

- `@jskit-ai/database-runtime` and `@jskit-ai/resource-runtime` are peer dependencies, required and at the same versions, where they were dependencies: its settings are a table resource, and the app holds one copy of the table runtime that every package shares, as it does the kernel. npm installs a required peer as it installed the dependency, so an app installs the same packages and versions; a release whose versions disagree now fails the install with ERESOLVE instead of nesting a second copy.
- **Breaking (data-access redesign).** The console settings operations are an API contract, `consoleSettingsContract`, which replaces `consoleSettingsResource`, with the two its routes serve: view (GET) and patch (PATCH), each with the method of the route that serves it.
- The console resources' validation feedback names the catalog key `jskit.console.feedback.validationFailed` instead of plain English; JSKIT's forms render it with `text()`, so the English shown is unchanged. `apiValidation` is sent in the coded form with `validation_failed`.
- **Breaking (data-access redesign).** The console's settings record is its owner's capability, `console.settings` (the console settings repository: `getSingleton(options)` reads `{ id, ownerUserId, settings, createdAt, updatedAt }`), provided by `ConsoleFeature`; `console.core` no longer has `repositories`. Its type is `ConsoleSettings`.

### Upgrading

- Code that read `repositories.settings` of `console.core` requires `console.settings`.

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
