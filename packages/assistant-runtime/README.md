# @jskit-ai/assistant-runtime

Hosts JSKIT's common conversation runtime (from `@jskit-ai/assistant-core`)
through authorized HTTP operations, shared realtime subscriptions and Vue/Vuetify
conversation elements. Package discovery registers `AssistantFeature` once on a
JSKIT host; plain Fastify hosts use `registerFastifyConversations`.

Two hosting modes share that runtime:

- **Application-supplied runtime.** The host supplies its own
  `createConversationRuntime` (file or application storage) as the
  `assistant.conversations` capability. No database is required.
- **Built-in database-backed surface.** The optional SQL integration adds
  database conversations, per-surface settings and the request-streaming chat
  route. It needs `npm run db:migrate` and is composed by the
  `assistant/assistant-surface` pattern.

Main exports by subpath:

| Subpath | Provides |
| --- | --- |
| `@jskit-ai/assistant-runtime/server` | `AssistantFeature`, `createAssistantActions`, `registerAssistantRoutes`, `registerConversationSubscriptions`, `registerFastifyConversations` |
| `@jskit-ai/assistant-runtime/server/actionIds` | Assistant action identifiers |
| `@jskit-ai/assistant-runtime/client` | `AssistantConversationClientElement`, `AssistantSurfaceClientElement`, `AssistantSettingsClientElement`, `useAssistantConversation`, `configureAssistantConversations` |
| `@jskit-ai/assistant-runtime/shared` | Assistant surface configuration helpers |

The full guides are in the JSKIT agent docs:
`packages/agent-docs/site/guide/app-extras/assistant.md` (setup and hosting
modes) and `packages/agent-docs/site/guide/app-extras/assistant-conversation.md`
(client contract and advanced host facilities).

## Subscription diagnostics

With the existing realtime diagnostic option (`JSKIT_REALTIME_DEBUG=1`, or
`config.realtime.debug=true`), conversation subscriptions emit one `pending`
warning if admission/snapshot reading has not returned within the client's
10-second budget, after which the client shows a loading notice and keeps waiting
(it gives up only after 120 seconds). The warning names the current stage and the
server-generated epoch; a conversation identity is included only after its
successful authorized open. Observer release also records the current stage and
reason. While diagnostics are enabled, every stage transition is recorded at
warning level with its duration and total elapsed time, so warning-only logs
retain the earlier admission costs as well as the step pending at timeout.
Timers are removed on acknowledgement, failure, replacement, unsubscribe
and connection close. Diagnostics contain no request body or conversation text,
and do not change authorization, subscription deadlines or model work.

## Subscription release

Released subscriptions stop setup at the next completed phase. The existing
socket owner supplies its current subscription identity to the subscribe action;
an obsolete open cannot attach a new observer, and a late observer is detached
without starting a snapshot. Reads already in progress may finish, but cannot
acknowledge into a replacement view. Reload performs fresh authorization, and
releasing a view never stops its model turn.

## Queued prepared submissions

Prepared application submissions may explicitly enable `queueWhileSending` to
reuse the binding's serial delivery queue while application preparation is still
running. Each queued request retains its captured payload and receipt identity.
Stop and conversation retirement cancel queued preparation through the existing
owner. A typed, definite ended-turn rejection may become one ordinary Send with
the same identity, without repeating preparation; uncertain delivery never
permits replay. With the option absent or false, prepared submissions retain
their existing non-queueing behavior.
