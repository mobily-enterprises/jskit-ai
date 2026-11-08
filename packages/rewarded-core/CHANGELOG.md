# Changelog

## Unreleased

- The rewarded table resources no longer declare their own `id` search entry: their handles' `id` filter takes one id or a list.
- The package requires `crud.contracts`, the registry of served CRUD contracts its CRUD features register with, so an application that installs it also loads crud-core's `CrudContractsProvider`.
- The rewarded CRUD contracts name every field they show and accept, since a contract now shows only the fields it names; what each one shows and accepts is unchanged.
- **Breaking (data-access redesign).** Each rewarded table is one table resource with a CRUD contract on it: `rewardedRuleTableResource`/`rewardedRuleCrud`, `rewardedProviderConfigTableResource`/`rewardedProviderConfigCrud`, `rewardedWatchSessionTableResource`/`rewardedWatchSessionCrud` and `rewardedUnlockReceiptTableResource`/`rewardedUnlockReceiptCrud`, exported from `./shared`. The HTTP routes, namespaces and fields are unchanged.
- The rewarded resources' save, delete and validation feedback names catalog keys under `jskit.rewarded.feedback.*` instead of plain English; JSKIT's forms render them with `text()`, so the English shown is unchanged.

### New message keys (5)

<details><summary>Key list</summary>

- `jskit.rewarded.feedback.fixInvalidValues`
- `jskit.rewarded.feedback.recordSaved`
- `jskit.rewarded.feedback.recordSaveFailed`
- `jskit.rewarded.feedback.recordDeleted`
- `jskit.rewarded.feedback.recordDeleteFailed`

</details>

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
