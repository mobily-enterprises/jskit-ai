# Shared UI System

Last validated: 2026-02-24 (UTC)

This is the single source of truth for shared client-element UI ownership, customization, migration, and ejection.

Superseded docs were archived under `docs/archive/historical-2026-02-24/shared-ui/`.

## Purpose

Shared UI packages own reusable domain markup and local component behavior so apps can:

- avoid duplicating domain templates,
- keep app wrappers thin,
- customize through explicit contracts (props/events/slots),
- and fork cleanly when customization exceeds package seams.

## Current Package Inventory

| Package | Package Path | Source Export(s) |
| --- | --- | --- |
| `@jskit-ai/assistant-client-element` | `packages/ai-agent/assistant-client-element` | `./source/AssistantClientElement.vue` |
| `@jskit-ai/assistant-transcript-explorer-client-element` | `packages/ai-agent/assistant-transcript-explorer-client-element` | `./source/AssistantTranscriptExplorerClientElement.vue` |
| `@jskit-ai/billing-plan-client-element` | `packages/billing/billing-plan-client-element` | `./source/BillingPlanClientElement.vue` |
| `@jskit-ai/billing-commerce-client-element` | `packages/billing/billing-commerce-client-element` | `./source/BillingCommerceClientElement.vue` |
| `@jskit-ai/billing-console-admin-client-element` | `packages/billing/billing-console-admin-client-element` | `./source/ConsoleBillingPlansClientElement.vue`, `./source/ConsoleBillingProductsClientElement.vue` |
| `@jskit-ai/chat-client-element` | `packages/chat/chat-client-element` | `./source/ChatClientElement.vue` |
| `@jskit-ai/console-errors-client-element` | `packages/observability/console-errors-client-element` | `./source/ConsoleErrorListClientElement.vue`, `./source/ConsoleErrorDetailClientElement.vue` |
| `@jskit-ai/members-admin-client-element` | `packages/users/members-admin-client-element` | `./source/MembersAdminClientElement.vue` |
| `@jskit-ai/profile-client-element` | `packages/users/profile-client-element` | `./source/ProfileClientElement.vue` |

## Current App Usage Map (`apps/jskit-value-app`)

| View Wrapper | Imported Package Component(s) |
| --- | --- |
| `apps/jskit-value-app/src/views/assistant/AssistantView.vue` | `@jskit-ai/assistant-client-element` (`AssistantClientElement`) |
| `apps/jskit-value-app/src/views/chat/ChatView.vue` | `@jskit-ai/chat-client-element` (`ChatClientElement`) |
| `apps/jskit-value-app/src/views/workspace-billing/WorkspaceBillingView.vue` | `@jskit-ai/billing-plan-client-element` (`BillingPlanClientElement`), `@jskit-ai/billing-commerce-client-element` (`BillingCommerceClientElement`) |
| `apps/jskit-value-app/src/views/workspace-transcripts/WorkspaceTranscriptsView.vue` | `@jskit-ai/assistant-transcript-explorer-client-element` (`AssistantTranscriptExplorerClientElement`) |
| `apps/jskit-value-app/src/views/workspace-admin/WorkspaceMembersView.vue` | `@jskit-ai/members-admin-client-element` (`MembersAdminClientElement`) |
| `apps/jskit-value-app/src/views/settings/profile/SettingsProfileForm.vue` | `@jskit-ai/profile-client-element` (`ProfileClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleAiTranscriptsView.vue` | `@jskit-ai/assistant-transcript-explorer-client-element` (`AssistantTranscriptExplorerClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleBillingPlansView.vue` | `@jskit-ai/billing-console-admin-client-element` (`ConsoleBillingPlansClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleBillingProductsView.vue` | `@jskit-ai/billing-console-admin-client-element` (`ConsoleBillingProductsClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleMembersView.vue` | `@jskit-ai/members-admin-client-element` (`MembersAdminClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleServerErrorsView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorListClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleServerErrorDetailView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorDetailClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleBrowserErrorsView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorListClientElement`) |
| `apps/jskit-value-app/src/views/console/ConsoleBrowserErrorDetailView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorDetailClientElement`) |

## Ownership Boundaries

Package-owned:

- domain UI markup and local interaction behavior,
- package-level slots/events/variants,
- package-local tests and docs.

App-owned:

- routing, authz/policy wiring, and feature gating,
- runtime/composable orchestration and dependency injection,
- API calls and persistence orchestration,
- product-specific analytics/instrumentation behavior.

## Customization Contract

Core package baseline (billing-plan/chat/assistant/profile) uses grouped host contracts:

- props: `meta`, `state`, `actions`, with optional `copy`, `variant`, `features`, `ui`.
- events: `action:started`, `action:succeeded`, `action:failed`, `interaction`, plus domain-specific events.
- slots: package-defined extension slots (for example `header-extra`, `footer-extra`, domain slots).

Other client-element packages may use domain-specific prop/event shapes. Treat each package README as the API contract.

## Migration Checklist

1. Create or update package client-element scaffolding and exports.
2. Move reusable domain markup out of app view into package SFC.
3. Keep app wrapper thin and pass runtime state/actions through.
4. Add/refresh package tests (render + emits + slot/variant coverage).
5. Add/refresh app wrapper tests asserting direct package import usage.
6. Add/refresh architecture guardrails as package scope expands.

## Eject Workflow

Eject when host-level customization exceeds slots/variants/copy/ui hooks and a hard local fork is needed.

Manual source copy pattern:

```bash
cp node_modules/@jskit-ai/chat-client-element/src/ChatClientElement.vue apps/jskit-value-app/src/components/ChatClientElement.ejected.vue
```

CLI workflow (from repo root):

```bash
npm exec -w apps/jskit-value-app jskit-app-scripts -- element:eject --source @jskit-ai/chat-client-element/source/ChatClientElement.vue --target src/components/ChatClientElement.ejected.vue
npm exec -w apps/jskit-value-app jskit-app-scripts -- element:diff --source @jskit-ai/chat-client-element/source/ChatClientElement.vue --target src/components/ChatClientElement.ejected.vue --check
```

Ejection policy:

- ejected files become app-owned,
- upstream package changes no longer apply automatically,
- use `element:diff --check` for drift visibility where needed.

## Guardrails and Validation

- Shared UI guardrails (core subset): `npm run test:architecture:shared-ui`
  - enforced set currently covers `billing-plan`, `chat`, `assistant`, and `profile` client elements.
- View wrapper import checks for additional client elements exist in `apps/jskit-value-app/tests/views/*.vitest.js`.
- Note: `npm run test:architecture:client` currently fails because its Vue-SFC allowlist does not yet include all current client-element packages.
