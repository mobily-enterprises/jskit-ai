# Guide

JSKIT is an AI-first framework and tested source-pattern library. It owns
strong runtime APIs, package composition contracts, and examples an agent can
apply or adapt. It does not prescribe an agent host or project orchestrator.

## Start here

- [Quickstart](/guide/app-setup/quickstart)
- [Application foundations](/guide/app-setup/initial-scaffolding)
- [Upgrade JSKIT](/guide/app-setup/upgrading-jskit)
- [Migrate an existing application](/guide/app-setup/existing-application-migration)
- [A more interesting shell](/guide/app-setup/a-more-interesting-shell)
- [Authentication](/guide/app-setup/authentication)
- [Sign in through an OIDC issuer](/guide/app-setup/sign-in-through-oidc-issuer)
- [Run an accounts hub](/guide/app-setup/run-an-accounts-hub)
- [Database layer](/guide/app-setup/database-layer)
- [Users](/guide/app-setup/users)
- [Multi-homing](/guide/app-setup/multi-homing)
- [Console](/guide/app-setup/console)

## Framework reference

- [Application operations](/guide/framework/application-operations)
- [CRUD operations](/guide/framework/crud-operations)
- [Record form actions](/guide/framework/crud-form-actions)
- [UI operations](/guide/framework/ui-operations)
- [Material 3](/guide/framework/material-3)
- [Translating a JSKIT app](/guide/framework/translation)
- [Complete source pattern library](/patterns/)

## Optional capabilities

- [Mobile Capacitor](/guide/app-extras/mobile-capacitor)
- [Realtime](/guide/app-extras/realtime)
- [Assistant](/guide/app-extras/assistant)
- [Embeddable assistant conversations](/guide/app-extras/assistant-conversation)
- [Voice conversations](/guide/app-extras/assistant-voice)

## How to use the guide

Begin with the Quickstart and one application-foundation pattern. Add only the
capabilities selected by the product. The public pattern library contains every
published `PATTERN.md` and links its complete example tree. If a runtime package
is installed, its package-owned copy is the version-matched implementation
reference. The optional standalone JSKIT Agent Skill bundles the same pattern
documents and examples, but no agent host is required to install it.

There are no source-generator chapters. Package-owned patterns replace their
useful source examples; questionnaire, mutation, and provenance machinery is
not part of JSKIT. The supported `jskit update` and `jskit check` commands own
only dependency manifests and lockfile conformance.
