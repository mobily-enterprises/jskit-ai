# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (11)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.rewarded.gate.eyebrow`
- `jskit.rewarded.gate.defaultTitle`
- `jskit.rewarded.gate.defaultDescription`
- `jskit.rewarded.gate.loading`
- `jskit.rewarded.gate.startFailed`
- `jskit.rewarded.gate.watch`
- `jskit.rewarded.gate.notNow`
- `jskit.rewarded.gate.close`
- `jskit.rewarded.gate.adUnavailable`
- `jskit.rewarded.gate.invalidState`
- `jskit.rewarded.gate.alreadyActive`

</details>

### Codes (2)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `rewarded.gate.invalidState` | Rewarded gate returned an invalid state. |
| `rewarded.gate.alreadyActive` | A Rewarded gate is already active. |
