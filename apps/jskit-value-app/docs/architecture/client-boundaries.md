# Client Boundaries and Shared UI Contract

Last validated: 2026-02-24 (UTC)

This document is the single contract for package-level client rules, customization seams, and shared UI ownership.

## Scope

- Applies to package JS modules under `packages/**/src/**`.
- Vue SFC (`.vue`) usage is limited to client-element packages.
- Applies to current and future apps consuming package client/runtime modules.

## Package Contract

Allowed in packages:

- Domain logic and state transitions.
- Runtime composables/hooks and query helpers.
- API/client transport helpers.
- Data mappers, validation, and contracts.
- Reactive/runtime utilities that stay UI-agnostic.
- Package-owned client-element SFCs only in approved client-element package paths.

Not allowed in packages:

- Vue SFCs outside client-element package paths.
- Style imports (`.css`, `.scss`, `.sass`, `.less`, `.styl`, `.stylus`).
- Visual framework coupling (`vuetify`, icon packs, UI kits).
- Rendering-entry assumptions (`createApp`, `defineComponent`, app boot behavior).
- UI policy literals that belong to app surfaces (layout, class naming, styling policy).

## Runtime Composition Rules

- Package client runtimes must use factory APIs with closure-scoped dependencies.
- Mutable module-level runtime configuration is not allowed.
- `configureAssistantRuntime` / `configureChatRuntime` global mutation patterns are forbidden.
- App-specific dependency wiring belongs in app composition roots, for example `apps/*/src/modules/*/runtime.js`.

## Wrapper Rules

App wrappers are valid only when they add:

- app-specific transformation,
- app-specific policy,
- app-specific dependency composition,
- compatibility boundary with documented reason.

Pure pass-through wrappers must be removed.

## Variability Matrix

| Variation Axis | Owner | Canonical Artifact | How To Customize | Guardrail | Required Tests |
| --- | --- | --- | --- | --- | --- |
| OAuth provider catalog | Package (`access-core`) | `packages/auth/access-core/src/oauthProviders.js` | Extend provider metadata and normalization in `oauthProviders.js`; keep method wiring aligned with `packages/auth/access-core/src/authMethods.js`. | Package explicit exports + architecture guardrails; avoid app-local OAuth forks. | `apps/jskit-value-app/tests/oauthFlowsAndAuthMethods.test.js` |
| Realtime topic policy | App | `apps/jskit-value-app/shared/topicRegistry.js` | Change allowed topics and permission mappings in app registry only; keep runtime contracts in `@jskit-ai/realtime-contracts`. | Client architecture guardrails + app topic policy tests. | `apps/jskit-value-app/tests/realtimeArchitecture.test.js`, `apps/jskit-value-app/tests/realtimeRoutes.test.js` |
| Settings model extension | Package (`workspace-console-core`) | `packages/workspace/workspace-console-core/src/settingsModel.js` | Add fields/specs, then update schema/patch builders and downstream adapters. | Headless client contract + package seam guardrails (`no export *`, no visual coupling). | `apps/jskit-value-app/tests/settingsRouteSchema.test.js`, `apps/jskit-value-app/tests/settingsServiceCompatibility.test.js` |
| Feature flags | Shared (model + persistence adapters) | `packages/workspace/workspace-console-core/src/settingsModel.js`, `packages/workspace/workspace-knex-mysql/src/repositories/settings.repository.js` | Add/modify feature flags in model and persist/load via settings repository + services. | Package boundary tests + runtime env/schema checks in CI. | `apps/jskit-value-app/tests/appConfigAndRbacManifest.test.js`, `apps/jskit-value-app/tests/workspaceServiceSurfacePolicy.test.js` |
| Theming tokens/mapping | Shared (package tokens + app shell mapping) | `packages/workspace/workspace-console-core/src/workspaceColors.js`, `apps/jskit-value-app/src/app/shells/shared/workspaceTheme.js` | Adjust canonical color constraints in package; map tokens to app theme variables in shell composition. | Headless contract (tokens/policy only, no styling/render imports). | `apps/jskit-value-app/tests/workspaceDomainModules.test.js` |
| Surface registry/prefix policy | App | `apps/jskit-value-app/shared/surfaceRegistry.js` | Modify surfaces/prefix policy in app registry and path helpers. | App-only ownership enforced by architecture guardrails. | `apps/jskit-value-app/tests/surfacePathsAndRegistry.test.js`, `apps/jskit-value-app/tests/appSurfaceAccess.test.js` |
| Runtime dependency composition | App composition root | `apps/jskit-value-app/src/modules/assistant/runtime.js`, `apps/jskit-value-app/src/modules/chat/runtime.js` | Instantiate runtime factories with app dependencies without mutating package globals. | `configure*Runtime` prohibition + thin-wrapper/internal-import guardrails. | `apps/jskit-value-app/tests/client/assistantView.vitest.js`, `apps/jskit-value-app/tests/client/chatView.vitest.js`, `tests/architecture/client-architecture.guardrails.test.mjs` |

## Shared Client-Element Inventory

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
| `src/views/assistant/AssistantView.vue` | `@jskit-ai/assistant-client-element` (`AssistantClientElement`) |
| `src/views/chat/ChatView.vue` | `@jskit-ai/chat-client-element` (`ChatClientElement`) |
| `src/views/workspace-billing/WorkspaceBillingView.vue` | `@jskit-ai/billing-plan-client-element` (`BillingPlanClientElement`), `@jskit-ai/billing-commerce-client-element` (`BillingCommerceClientElement`) |
| `src/views/workspace-transcripts/WorkspaceTranscriptsView.vue` | `@jskit-ai/assistant-transcript-explorer-client-element` (`AssistantTranscriptExplorerClientElement`) |
| `src/views/workspace-admin/WorkspaceMembersView.vue` | `@jskit-ai/members-admin-client-element` (`MembersAdminClientElement`) |
| `src/views/settings/profile/SettingsProfileForm.vue` | `@jskit-ai/profile-client-element` (`ProfileClientElement`) |
| `src/views/console/ConsoleAiTranscriptsView.vue` | `@jskit-ai/assistant-transcript-explorer-client-element` (`AssistantTranscriptExplorerClientElement`) |
| `src/views/console/ConsoleBillingPlansView.vue` | `@jskit-ai/billing-console-admin-client-element` (`ConsoleBillingPlansClientElement`) |
| `src/views/console/ConsoleBillingProductsView.vue` | `@jskit-ai/billing-console-admin-client-element` (`ConsoleBillingProductsClientElement`) |
| `src/views/console/ConsoleMembersView.vue` | `@jskit-ai/members-admin-client-element` (`MembersAdminClientElement`) |
| `src/views/console/ConsoleServerErrorsView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorListClientElement`) |
| `src/views/console/ConsoleServerErrorDetailView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorDetailClientElement`) |
| `src/views/console/ConsoleBrowserErrorsView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorListClientElement`) |
| `src/views/console/ConsoleBrowserErrorDetailView.vue` | `@jskit-ai/console-errors-client-element` (`ConsoleErrorDetailClientElement`) |

## Eject Workflow

Use ejection when host-level customization exceeds package slots/variants/copy/ui hooks.

Manual source copy:

```bash
cp node_modules/@jskit-ai/chat-client-element/src/ChatClientElement.vue apps/jskit-value-app/src/components/ChatClientElement.ejected.vue
```

CLI workflow:

```bash
npm exec -w apps/jskit-value-app jskit-app-scripts -- element:eject --source @jskit-ai/chat-client-element/source/ChatClientElement.vue --target src/components/ChatClientElement.ejected.vue
npm exec -w apps/jskit-value-app jskit-app-scripts -- element:diff --source @jskit-ai/chat-client-element/source/ChatClientElement.vue --target src/components/ChatClientElement.ejected.vue --check
```

Policy:

- Ejected files become app-owned.
- Upstream package changes do not apply automatically.
- Use `element:diff --check` to monitor drift.

## Enforcement

- `node --test tests/architecture/client-architecture.guardrails.test.mjs`
- `npm run lint:architecture:client`
- `npm run test:architecture:shared-ui`
- Additional wrapper import checks: `apps/jskit-value-app/tests/views/*.vitest.js`

CI should keep architecture checks as required merge gates.
