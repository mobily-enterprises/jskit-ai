# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (14)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.rewarded_unlock_required`
- `jskit.errors.rewarded_cooldown_active`
- `jskit.errors.rewarded_daily_limit_reached`
- `jskit.errors.rewarded_not_configured`
- `jskit.errors.rewarded_unlock_blocked`
- `jskit.errors.rewarded_gate_state_invalid`
- `jskit.rewarded.auth.required`
- `jskit.rewarded.request.workspaceSlugRequired`
- `jskit.rewarded.request.gateKeyRequired`
- `jskit.rewarded.request.sessionIdRequired`
- `jskit.rewarded.session.notFound`
- `jskit.rewarded.session.grantNotAuthorized`
- `jskit.rewarded.session.closed`
- `jskit.rewarded.session.ruleMissing`

</details>

### Codes (14)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `rewarded_unlock_required` | Rewarded unlock required. |
| `rewarded_cooldown_active` | Rewarded unlock is cooling down. |
| `rewarded_daily_limit_reached` | Rewarded unlock limit reached. |
| `rewarded_not_configured` | Rewarded gate is not configured. |
| `rewarded_unlock_blocked` | Rewarded unlock is required before this action can continue. |
| `rewarded_gate_state_invalid` | Rewarded gate returned an invalid state. |
| `rewarded.auth.required` | Authentication required. |
| `rewarded.request.workspaceSlugRequired` | workspaceSlug is required. |
| `rewarded.request.gateKeyRequired` | gateKey is required. |
| `rewarded.request.sessionIdRequired` | sessionId is required. |
| `rewarded.session.notFound` | Watch session not found. |
| `rewarded.session.grantNotAuthorized` | Reward grant is not authorized. |
| `rewarded.session.closed` | Watch session is already closed. |
| `rewarded.session.ruleMissing` | No rewarded rule is configured for this session. |
