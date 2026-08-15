---
id: auth/auth-surface
title: Authentication surface
summary: Compose JSKIT authentication routes, views, profile controls, and public surface configuration without generated source.
keywords: account, auth, login, logout, password, placement, profile, reset, surface
requires: @jskit-ai/auth-core, @jskit-ai/auth-web, @jskit-ai/shell-web
---

# Authentication surface

## Use when

Use this pattern when an application needs browser login, sign-out, password
reset, and authenticated profile controls through JSKIT's auth runtime.

## Do not use when

Do not use this pattern for an API-only service, an application that delegates
all authentication UI to another product, or a second auth stack beside JSKIT.

## Product decisions

Choose the auth provider, permitted login methods, public routes, post-login
destination, account language, and which profile actions belong in the shell.
Those choices must be known before adapting the example.

## Framework APIs

Use the views, auth guard, HTTP client integration, sign-out runtime, providers,
and Playwright auth helper exported by `@jskit-ai/auth-web`. Use auth policies
from `@jskit-ai/auth-core` for server authorization.

## Invariants

- Credentials and provider secrets come from environment values.
- Public auth routes do not require an existing session.
- Protected routes use the framework auth policy rather than page-local checks.
- Login, sign-out, and reset views use the public auth components/composables.
- Profile placements are conditional on the current authenticated state.
- Transient mutation failures use the application toast; initial load failures
  remain in the affected surface.

## Example files

`example/` contains concrete route wrappers, editable view wrappers, and the
client runtime helpers needed by an authentication surface. Compose their
surface and placement declarations into the application's ordinary config and
placement files.

## Variation points

Change provider, routes, labels, page wrappers, permitted login methods, profile
placements, and post-auth destinations while retaining the runtime contracts.

## Verification

Exercise failed and successful login, sign-out, reset, protected navigation,
keyboard interaction, warm-cache return navigation, and browser refresh.

## Avoid

- storing credentials in source
- copying auth repositories or session mechanics into the app
- redirect loops between public and protected surfaces
- generator commands, mutation metadata, or setup receipts
