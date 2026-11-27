# Guide

JSKIT is an AI-first framework and tested source-pattern library. It owns
strong runtime APIs, package composition contracts, and examples an agent can
apply or adapt. It does not prescribe an agent host or project orchestrator.

## Start here

- [Quickstart](/guide/app-setup/quickstart)
- [Application foundations](/guide/app-setup/initial-scaffolding)
- [Upgrade JSKIT](/guide/app-setup/upgrading-jskit)
- [Package an app with Nix](/guide/app-setup/package-with-nix): for a host that
  runs apps only as Nix packages, built with no network access
- [Run on more than one server](/guide/app-setup/more-than-one-server): files,
  live updates, sessions, scheduled work and migrations when several copies
  run behind a load balancer
- [Move an app to the Material 3 defaults](/guide/app-setup/material-3-migration)
- [Migrate an existing application](/guide/app-setup/existing-application-migration)
- [A more interesting shell](/guide/app-setup/a-more-interesting-shell)
- [Authentication](/guide/app-setup/authentication)
- [Sign in through an OIDC issuer](/guide/app-setup/sign-in-through-oidc-issuer)
- [Service keys](/guide/app-setup/service-keys): another application's server
  calls this app as one of its users at a time
- [Run an accounts hub](/guide/app-setup/run-an-accounts-hub)
- [Database layer](/guide/app-setup/database-layer)
- [Users](/guide/app-setup/users)
- [Multi-homing](/guide/app-setup/multi-homing)
- [Console](/guide/app-setup/console)

## Framework reference

- [Application operations](/guide/framework/application-operations)
- [Data access](/guide/framework/data-access): read before any code that reads
  or writes a database table
- [CRUD operations](/guide/framework/crud-operations)
- [Record form actions](/guide/framework/crud-form-actions)
- [Typed features](/guide/framework/typed-features): read before writing any
  server feature, provider, action, service or repository
- [Client features](/guide/framework/client-features): read before writing any
  composable, component, client factory or client provider
- [UI operations](/guide/framework/ui-operations)
- [Material 3](/guide/framework/material-3)
- [UI pass](/guide/framework/ui-pass): make a task's changes, a section or the
  whole app exact Material 3
- [Visual identity](/guide/framework/visual-identity): where an identity pass's
  theme, content colours, artwork, logo, loading screen and sign-in live
- [Quality pass](/guide/framework/quality-pass): loading, empty, error and
  refused states, edge cases and accessibility, checked by using the app
- [Data pass](/guide/framework/data-pass): query counts, constraints,
  migrations and indexes at realistic sizes, on PostgreSQL and MySQL
- [Security pass](/guide/framework/security-pass): route permissions,
  workspace scoping, rate limits, sessions, the first account and production
  settings, each refusal tried
- [User experience pass](/guide/framework/ux-pass): navigation, the next
  action, form defaults, where a save lands, undo and the words people read,
  each main task walked before and after
- [Speed pass](/guide/framework/speed-pass): test suite time, parallel files and
  preparation once per run, first-load chunks, requests per screen and route
  times, each measured before and after
- [Sanity checks](/guide/framework/sanity-checks): JSKIT's own pitfalls, and
  the JSKIT calls that check data access, tests, a refactor, a screen or a
  deployment before calling it done
- [Environments](/guide/framework/environments): read before code that sends
  email, messages or payments, calls another system, or depends on where the
  app runs (`APP_ENV`)
- [Translating a JSKIT app](/guide/framework/translation)
- [Complete source pattern library](/patterns/)

## Optional capabilities

- [Mobile Capacitor](/guide/app-extras/mobile-capacitor)
- [Realtime](/guide/app-extras/realtime)
- [Assistant](/guide/app-extras/assistant)
- [Embeddable assistant conversations](/guide/app-extras/assistant-conversation)
- [Voice conversations](/guide/app-extras/assistant-voice)

## Recipes

Ready prompts for what people commonly ask an app to do, each naming JSKIT's
own owners so nothing gets invented. Paste one into a session as it is. Each
says how to answer the person: propose the simple way first, then say there
are other options if you want to discuss. A study changes nothing and ends in
a plan.

- [An app people install from its website](/guide/recipes/installable-app):
  use when someone wants the app on their phone, an icon, push
  notifications, an unread badge or sharing into the app; a native store app
  through Capacitor is the other option
- [Offline study](/guide/recipes/offline-study): use when someone wants the
  app to work offline or without signal; recommends what works offline,
  section by section
- [Usefulness study](/guide/recipes/usefulness-study): use when someone asks
  whether the app is any good, what is missing or what to build next; judges
  value and gaps, not ease of use
- [Payments and subscriptions](/guide/recipes/payments-and-subscriptions): use
  when someone wants to charge for the app, sell plans, gate features behind
  a plan or sell credits
- [Inviting people with roles](/guide/recipes/invite-people-with-roles): use
  when someone wants to invite their team, share records with colleagues or
  give people different permissions
- [File uploads and images](/guide/recipes/file-uploads-and-images): use when
  someone wants photos, documents or other files attached to records
- [Reminders and digests](/guide/recipes/reminders-and-digests): use when
  someone wants reminders, scheduled emails or a daily or weekly summary sent
  to people
- [Another language](/guide/recipes/another-language): use when someone wants
  the app translated or available in more than one language

## How to use the guide

Begin with the Quickstart and one application-foundation pattern. Add only the
capabilities selected by the product. Server code follows Typed features from
its first line; the foundations' lint configuration reports what breaks it. The public pattern library contains every
published `PATTERN.md` and links its complete example tree. If a runtime package
is installed, its package-owned copy is the version-matched implementation
reference. The optional standalone JSKIT Agent Skill bundles the same pattern
documents and examples, but no agent host is required to install it.

There are no source-generator chapters. Package-owned patterns replace their
useful source examples; questionnaire, mutation, and provenance machinery is
not part of JSKIT. The supported `jskit update` and `jskit check` commands own
only dependency manifests and lockfile conformance.
