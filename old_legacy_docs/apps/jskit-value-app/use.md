# Package Usage Review

Legend for `Page-local?`:
- `Shared`: keep in package.
- `Shared+Config`: keep shared, but expose app-level configuration.
- `App-specific candidate`: move or override in app if your 22 apps diverge.

## Assistant

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/ai-agent/assistant-client-runtime/src/assistantApi.js` | HTTP + stream client for assistant chat/conversation endpoints | Normalize assistant API calls and stream error handling | `AssistantView` (via app `api.ai` service), assistant client tests | Shared |
| `packages/ai-agent/assistant-client-runtime/src/useAssistantRuntime.js` | Vue runtime/composable for assistant state, streaming, history, tool timeline | Full assistant UI behavior engine | `AssistantView.vue` | Shared+Config |
| `packages/ai-agent/assistant-contracts/src/queryKeys.js` | TanStack query key builders for assistant lists/messages | Cache invalidation consistency | Used by assistant runtime package; app re-export exists | Shared |
| `packages/ai-agent/assistant-contracts/src/streamEvents.js` | Assistant stream event type catalog + normalizers | Keep event parsing strict and stable | Assistant runtime + assistant API stream handling | Shared |
| `packages/ai-agent/assistant-contracts/src/transcriptQueryKeys.js` | Query key builders for workspace AI transcripts | Transcript list/message cache keys | `WorkspaceTranscriptsView` and realtime invalidation path | Shared |

## Auth / Access

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/auth/access-core/src/authConstraints.js` | Auth length/regex constants | Shared validation limits | Server auth/settings schemas; indirectly login/reset UX rules | Shared |
| `packages/auth/access-core/src/authMethods.js` | Auth method IDs/kinds/definitions + parse/build helpers | Unified method policy model | `SettingsSecurityForm` and security logic | Shared+Config |
| `packages/auth/access-core/src/oauthCallbackParams.js` | OAuth callback query param constants | Prevent callback param drift | Login/settings OAuth callback utilities | Shared |
| `packages/auth/access-core/src/oauthProviders.js` | Provider metadata list + normalizer | Canonical provider catalog | `LoginView`, settings security OAuth linking | Shared+Config |
| `packages/auth/access-core/src/utils.js` | Normalize email, OAuth intent, return path | Input hygiene/safety for auth flow | Login helpers, OAuth callback helpers | Shared |
| `packages/auth/access-core/src/validators.js` | Client/server auth input validators | Reuse validation logic/messages | `LoginView`, `ResetPasswordView`, server auth/settings handlers | Shared |

## Chat

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/chat/chat-client-runtime/src/chatApi.js` | Chat REST endpoint client | Consistent chat transport calls | `ChatView` via app `api.chat` | Shared |
| `packages/chat/chat-client-runtime/src/useChatRuntime.js` | Full chat runtime/composable (threads/messages/typing/files) | Chat UI behavior/state orchestration | `ChatView.vue` and `WorkspaceChatView.vue` | Shared+Config |
| `packages/chat/chat-contracts/src/errors.js` | Chat error code -> user message mapping | Stable user-facing chat errors | Chat runtime/UI error banners | Shared |
| `packages/chat/chat-contracts/src/queryKeys.js` | Chat query key builders | Cache coherence for inbox/thread/messages | Chat runtime + realtime invalidation path | Shared |

## Realtime / Observability / Surface Routing

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/contracts/realtime-contracts/src/protocolTypes.js` | Realtime message/error enums | Client/server protocol contract | App realtime runtime; affects realtime-updated pages | Shared |
| `packages/contracts/realtime-contracts/src/topicCatalog.js` | Topic catalog builder and permission/surface checks | Declarative topic policy | App `shared/topicRegistry`, impacting chat/transcripts/other realtime views | Shared |
| `packages/observability/observability-core/src/browserPayload.js` | Builds browser error/rejection payloads | Uniform client-side error telemetry | Browser error reporter installed at app bootstrap (all pages) | Shared |
| `packages/realtime/realtime-client-runtime/src/commandTracker.js` | Tracks local commands, deferred events, dedupe | Correct realtime command/event reconciliation | App realtime services; indirectly affects realtime-enabled views | Shared |
| `packages/realtime/realtime-client-runtime/src/policies/reconnect.js` | Exponential backoff policy | Controlled reconnect behavior | Runtime internals (global realtime behavior) | Shared |
| `packages/realtime/realtime-client-runtime/src/policies/replay.js` | Replay limits policy | Bound deferred-event replay work | Runtime internals | Shared |
| `packages/realtime/realtime-client-runtime/src/runtime.js` | Core realtime client engine | Connection/subscription/event lifecycle | Started in app bootstrap for surfaces; impacts realtime-aware views | Shared |
| `packages/realtime/realtime-client-runtime/src/transportContract.js` | Socket transport adapter contract + Socket.IO impl | Pluggable realtime transport | Realtime runtime wrapper | Shared |
| `packages/surface-routing/src/paths.js` | Surface-aware path helpers | Cross-surface routing/path resolution | Router/shell/auth/login/workspace path behaviors | Shared |
| `packages/surface-routing/src/registry.js` | Surface registry factory | Canonical surface IDs/prefixes/workspace requirement | App shared surface registry; affects routing/navigation | Shared |

## Web Runtime

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/web/http-client-runtime/src/client.js` | Fetch client with CSRF, retries, JSON/NDJSON support | Robust web transport base | Used under app transport; effectively all API-backed views | Shared |
| `packages/web/http-client-runtime/src/errors.js` | HTTP/network error constructors | Consistent error shape | Internal to HTTP client/runtime | Shared |
| `packages/web/http-client-runtime/src/headers.js` | Header normalization/set-if-missing helpers | Safe header mutation logic | Internal to HTTP client | Shared |
| `packages/web/http-client-runtime/src/retry.js` | CSRF retry predicate logic | Controlled retry behavior | Internal to HTTP client | Shared |
| `packages/web/web-runtime-core/src/pagination.js` | Primitive page/pageSize math helpers | Reusable pagination basics | Re-exported in app utils; little direct page coupling | Shared |
| `packages/web/web-runtime-core/src/transportRuntime.js` | App HTTP runtime glue (surface headers, command IDs, NDJSON policy) | Bridge HTTP client to app context/realtime | App `services/api/transport` -> all API calls | Shared+Config |
| `packages/web/web-runtime-core/src/useListPagination.js` | Local pagination state composable | Base for list pagination UIs | Used by `useUrlListPagination` and tests | Shared |
| `packages/web/web-runtime-core/src/useListQueryState.js` | Normalizes query totals/loading for list UIs | Reduce repeated query-state boilerplate | `ProjectsList`, `Deg2radHistoryList`, `ConsoleBrowserErrors`, `ConsoleServerErrors` | Shared |
| `packages/web/web-runtime-core/src/useQueryErrorMessage.js` | Query error -> display message composable | Uniform async error presentation | Used through app wrapper across projects/console/chat/etc. | Shared |
| `packages/web/web-runtime-core/src/useUrlListPagination.js` | Sync pagination state with URL search params | Deep-linkable list pagination | `ProjectsList`, `Deg2radHistoryList`, `ConsoleBillingEvents`, `ConsoleBrowserErrors`, `ConsoleServerErrors` | Shared |

## Workspace Console Core

| File | 1) What it does | 2) What it’s for | 3) Which elements use it | 4) Page-local? |
|---|---|---|---|---|
| `packages/workspace/workspace-console-core/src/settingsModel.js` | Builds settings model: defaults/options/field specs | Single settings contract for client + server | Settings forms (`Profile/Preferences/Notifications/Chat`) and server settings schema/service | Shared+Config |
| `packages/workspace/workspace-console-core/src/settingsValidation.js` | Primitive coercion/validation helpers | Reusable typed validation layer | Used by settings model + server settings service | Shared |
| `packages/workspace/workspace-console-core/src/workspaceColors.js` | Validates/coerces workspace color values | Workspace branding safety | `AppShell`, `AdminShell`, `workspaceStore`, `WorkspacesView` | Shared+Config |

