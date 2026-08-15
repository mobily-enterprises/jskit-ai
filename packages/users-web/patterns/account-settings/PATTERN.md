---
id: users/account-settings
title: Account settings surface
summary: Compose an account settings route and profile, preference, and notification sections from JSKIT user web components.
keywords: account, notifications, preferences, profile, settings, user, vue
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

## Invariants

- Sections use JSKIT account settings APIs rather than direct HTTP helpers.
- Cached resource data hydrates local writable fields immediately.
- Mutation errors use the standard toast and do not push the form down.
- Loading uses layout-stable skeletons, never an indeterminate spinner.
- Pending controls keep stable labels and prevent duplicate submission.
- The route and placement owner agree.

## Example files

`example/` contains an account route and three concrete settings sections.
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
