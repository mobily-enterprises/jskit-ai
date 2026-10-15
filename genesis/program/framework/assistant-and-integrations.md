# Assistants and external integrations

Provides conversation runtimes, provider selection, voice support, reusable
connector account management, and focused third-party operations.

## Sources

- Main: `packages/assistant-core/src/server/conversation/provider.js`
- `packages/assistant-core/src/client/conversation/AssistantTranscript.vue`
- `packages/assistant-core/src/server/conversation/runtimeStateUpgrade.js`
- `packages/assistant-core/src/server/conversation/agentRun.js`
- `packages/assistant-runtime/src/server/AssistantProvider.js`
- `packages/assistant-voice/src/server/index.js`
- `packages/connectors-core/src/server/ConnectorsFeature.js`
- `packages/connectors-catalog/src/shared/definitions.js`

## Public contract

Applications select supported assistant and connector providers, retain their
own conversation and connection identities, and supply credentials through
server-side environment references. Conversations preserve provider lifecycle,
streaming, attachment, recovery, and storage contracts. Connector operations
remain scoped to the application and user or workspace that owns the account.

Transcript readers accept server-owned `pageUnit: "messages"` to count individual
user, assistant and system messages, excluding reasoning and commentary. The
default remains whole stored turns for internal consumers. The shared browser
page-size default is ten. Hosts select message pagination for browser reads.
History reads return an opaque `nextBeforeTurnId` cursor, including a message-role
boundary when a page splits a stored turn. Browser bindings follow that cursor
and merge partial turns without losing either half. Live patches retain whole
boundary turns and their progress rather than trimming by raw storage row count.
Pagination is a read-only projection; saved identities and records do not change.

The shared transcript sorts confirmed dated messages chronologically while
keeping optimistic authored messages in their supplied positions. A queued
message's earlier local timestamp cannot move it ahead of a preceding message
that receives its native timestamp later; receipts restore normal history ordering.

Native conversations optionally report content-free delivery timings through
`onDeliveryTiming`. One shared observer supplies milestone names, monotonic
durations and message attribution for Codex, Claude and OpenCode; their original
native owners mark acknowledgement before receipt persistence. Observer work
does not block dispatch or alter saved conversation data.

Claude's native turn owner follows automatic task-notification continuations and
the complete live background-task inventory. Non-ambient native work keeps the
conversation active, including Bash and remote tasks; repeated status events do
not complete the same activity twice. Steering after the main loop has finished
does not wait for another interrupt result from that finished loop. The retained
host receives normalized continuation and diagnostic events without prompt or
response contents, and continues to own persistence and operator logging.
Older completion checkpoints cannot overwrite a newer native continuation.
Split native text keeps its live output identity until the API message identifies
it as tool commentary or an answer; restored history uses the same classification.
Renewal recovery joins the exact running turn or requires its saved completed
state before accepting history text. Accepted but unconfirmed input is never
submitted again automatically.
The execution receipt remains observed after initialization, so a parent exit
cannot be hidden by children retaining its output pipe. Concurrent cleanup calls
join one process stop and its interrupted-state checkpoint. Unconfirmed retained
cleanup exposes observation loss through the existing host status contract.
Closing a session cancels native startup before waiting for preparation to drain;
late configuration cannot launch a successor after Stop. Failed cleanup retains
its owner for an explicit retry rather than starting another hidden stop attempt.
Account queries deduplicate by account identity, and invalidation cancels held
startup and reads before awaiting their owned cleanup. Borrowed conversations
remain owned by their original lifecycle. Requests also retain the invalidation
revision across account lookup and retained cleanup: an older request cannot
launch a successor process or refill the cache after reconnection.

The retained browser goal binding distinguishes an unknown goal from a confirmed
empty goal. Initial and replacement reads display loading; failed reads hide
stale actions and report unavailability. Starting, pausing, resuming and cancelling
labels describe the actual command, not a background read or message admission.
Codex Pause combines native scheduling pause with the existing verified turn
interrupt, preserving the goal identity and budget for Resume. Cleanup failure
is reported rather than treating paused scheduling as proof that work stopped.

The native settings bridge authorizes configuration against the original scope
and uses its configured host and driver. Claude applies model and effort controls
to the retained process during a turn when its instructions and tool identity
are unchanged. Codex model and effort changes confirm the native settings
snapshot, including an already-applied selection that emits no change event.
Provider changes use the existing thread-control recovery owner: hold goal
scheduling, let the current turn finish, refresh credentials and reload the same
thread, then restore only the same unchanged goal. Later settings replace a
pending choice; user Pause, Cancel, replacement and closure prevent automatic
restoration. Failed deferred changes expose the native paused goal and emit a
settings failure diagnostic. Neither operation sends another user message or
clears a goal.

An OpenCode process acquired for helpers can exist before the main conversation
has a native ID. Stopping its idle main turn is a no-op; session closure still
drains owned helpers and releases the process without interrupting peer sessions.
An active turn with a missing native identity remains an error, never a
successful Stop.
Shared acquisition and readiness propagate an expired health probe without
stopping the server. Main and temporary conversations retain their ownership;
a later readiness check can reuse the same process. Connection failures other
than that probe deadline retain the existing verified-stop recovery.

Explicit offline development copies use `prepareConversationRuntimeCopy` inside
an existing destination write transaction. Hosts own file isolation, stopped
processes and native goal pause before invoking it. The helper preserves history
and native identity, clears execution handles, interrupts running projections and
retains pending requests without replay. It requires version 3 and rejects an
unfinished replacement before writes; normal startup and historical upgrades do
not invoke it. `prepareCopiedConversationAgentRun` applies the same projection
policy to a separately stored legacy run without opening a provider.
