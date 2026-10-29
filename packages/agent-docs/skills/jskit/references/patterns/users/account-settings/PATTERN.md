---
id: users/account-settings
title: Account settings surface
summary: Compose an account settings route and profile, preference, notification, and sign-in method sections from JSKIT user web components.
keywords: account, notifications, preferences, profile, settings, sign-in methods, oauth, link provider, user, vue
requires: @jskit-ai/users-core, @jskit-ai/users-web, @jskit-ai/shell-web
---

# Account settings surface

## Use when

Use this pattern when authenticated users need to manage their own profile and
account preferences.

## Do not use when

Do not use this pattern for administrator-managed users, authentication
credential storage, or anonymous profile editing.

## Product decisions

Choose editable profile fields, preference vocabulary, notification options,
section order, and which account operations require reauthentication.

## Framework APIs

Use account settings elements and composables from `@jskit-ai/users-web`,
ordinary `useCommand()` mutation behavior, and JSKIT shell placements.

The runtime's `preferences.options.locale` lists the app's `config.languages`
(`[{ code, name }]` in the public app config), or a built-in list when the app
configures none; theme, date and number format options arrive translated. The
saved locale is a canonical BCP 47 code. `useAccountLocale()` from
`@jskit-ai/users-web/client` returns it as a read-only ref (`""` when signed
out), updated at bootstrap and after preferences save. JSKIT does not switch the
app's language; the app does, for example
`watch(useAccountLocale(), (code) => { if (code) i18n.global.locale.value = code; }, { immediate: true })`.
Section titles may be plain text, a message key or `{ key, fallback }`.

`runtime.signInMethods.methods` lists the auth provider's OAuth sign-in
methods as `{ provider, label, linked, canLink, canUnlink }`, read from the
settings security status. `link(provider)` leaves for the provider through
`GET /api/settings/security/oauth/:provider/start` and comes back to the current
page; `unlink(provider)` sends `DELETE /api/settings/security/oauth/:provider`
and reports the result with the standard toast. `canUnlink` is false for the
account's only sign-in method. Add this section only when the selected auth
provider offers provider linking (`providerLinking` in its capabilities).

## Invariants

- Sections use JSKIT account settings APIs rather than direct HTTP helpers.
- Settings pages and sections do not add headers or standalone headings by
  default.
- Cached resource data hydrates local writable fields immediately.
- Mutation errors use the standard toast and do not push the form down.
- Loading uses layout-stable skeletons, never an indeterminate spinner.
- Pending controls keep stable labels and prevent duplicate submission.
- The route and placement owner agree.

## Example files

`example/` contains an account route and four concrete settings sections.
Adapt their fields and copy while retaining the shared account runtime.

## Variation points

Change sections, fields, copy, order, permissions, preference choices, and
notification vocabulary while keeping server-owned validation authoritative.

## Verification

Navigate away and back with warm cache, exercise browser back/forward, save and
clear fields, verify toast errors, inspect skeleton geometry, and test keyboard
operation at compact and expanded widths.

## Avoid

- page-local request clients
- inline mutation alerts that shift content
- lazy non-immediate watchers for initial hydration
- copied user repositories or generator source markers
