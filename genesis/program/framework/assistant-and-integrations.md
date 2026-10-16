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

The shared transcript accepts Markdown tables with blank header cells when the
separator row establishes the column structure; paragraph whitespace handling
does not flatten recognized table rows.

The shared transcript sorts confirmed dated messages chronologically, including
accepted local copies whose canonical history page has not arrived, while
keeping unconfirmed authored messages in their supplied positions. A queued
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
Scoped Claude output also keeps its native input identity across accepted steering.
The native reader resolves that identity against saved authored request IDs, and
the existing transcript writer attaches partial and final output to that exact
turn. An unmatched identified output cannot fall back to the latest request.
Verified Stop also retains buffered or streaming partial text as commentary for
the existing transcript reader; unconfirmed cleanup leaves the stream incomplete.
This preserves displayed work without claiming a completed answer.
Renewal recovery joins the exact running turn or requires its saved completed
state before accepting history text. Accepted but unconfirmed input is never
submitted again automatically. Bound native goal Set/Resume may re-enter ordinary
admission once when native preparation returns the exact finished-turn rejection
with definite non-delivery. This waits for cleanup and final persistence, retains
the same message ID, and repeats target/access/cancellation checks; uncertainty
and a second failure never trigger another dispatch.
The execution receipt remains observed after initialization, so a parent exit
cannot be hidden by children retaining its output pipe. Concurrent cleanup calls
join one process stop and its interrupted-state checkpoint. Unconfirmed retained
cleanup exposes observation loss through the existing host status contract.
Observation and reconciliation distinguish an orphaned execution from the exact
pending cleanup lease owned by current Claude initialization. That transient
lease loses its pending flag on either startup success or failure; explicit Stop
retains its cleanup access throughout, and restored executions gain no exemption.
Closing a session cancels native startup before waiting for preparation to drain;
late configuration cannot launch a successor after Stop. Failed cleanup retains
its owner for an explicit retry rather than starting another hidden stop attempt.
Hosts may set a bounded cold-initialization timeout without extending ordinary
control deadlines; timeout still follows the same verified cleanup path.
Account queries deduplicate by account identity, and invalidation cancels held
startup and reads before awaiting their owned cleanup. Borrowed conversations
remain owned by their original lifecycle. Requests also retain the invalidation
revision across account lookup and retained cleanup: an older request cannot
launch a successor process or refill the cache after reconnection.

Claude goal creation and resumption use ordinary native message admission,
including steering while a turn is active. A new goal cannot replace an
unfinished goal; turn activity alone does not require cancellation.
Background-only steering retires the prior completion before host preparation,
so a task finishing during preparation cannot close the pending follow-up.
An application-owned account preparation may opt into following its current
authorized native account with `allowAccountChange`. Verified old-process cleanup
precedes identity persistence and same-history resume; standalone bindings retain
the default changed-account refusal. The standalone Claude driver exposes this
existing policy through the trusted `host.allowAccountChange` option. Completed
response inspection always keeps its original account pin, even for an opted-in
host; no past application effect acquires the replacement identity.

The retained browser goal binding distinguishes an unknown goal from a confirmed
empty goal. Initial and replacement reads display loading; failed reads hide
stale actions and report unavailability. Starting, pausing, resuming and cancelling
labels describe the actual command, not a background read or message admission.
An available host goal view can also carry a recovery error. The shared goal
state displays it without disabling the same-read target or Resume controls.
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

Claude's native pre-write turn guard reports definite non-delivery to the common
runtime. Its existing host rejection callback clears dispatch intent; attempted
writes without acknowledgements retain uncertain-delivery protection.


The retained conversation queue distinguishes the exact pre-admission native
turn-finished steer refusal from general steering failures. Its one ordinary-send
fallback preserves message identity, content and attachments, and persists the
new dispatch intent for explicit retry. Unknown/accepted delivery, retired actor
scope, goals and prepared application work do not qualify. Runtime finished-turn
guards mark definite non-delivery; the Codex driver preserves this marker instead
of converting it to uncertainty. Generic transport/provider failures stay unknown.

Claude command tracking distinguishes admitted user inputs from internally generated
lifecycle UUIDs. Internal starts can continue native work but do not replace the
input that owns its receipt and final answer. A matching `completed` lifecycle
retires its pending input; settlement still requires a native result and no
remaining commands or background tasks. Folded completion alone never confirms
an interrupt. The native owner regression tests cover the deployed CLI's folded
notification order, late completion after a successor starts, background work,
and preservation of the original published-answer owner.

If steering fails while interrupting the preceding generation, the next input
has not been written. After the original cleanup owner succeeds, the shared
owner preserves definite non-delivery rather than leaving an attempted receipt.
A failed cleanup retains its error and execution custody. Interrupt confirmation
timeouts are typed recoverable failures; a control acknowledgement alone still
cannot confirm the generation has ended.

Claude local command output carries its native system subtype in message data.
Synthetic assistant command replies also retain the explicit native command name
and stdout/stderr distinction; a successful result-only reply retains its command
identity. Neither reply wording nor the synthetic model name is classification
evidence. The existing transcript writer clones that optional data for every
role, retaining protocol provenance without interpreting application presentation
policy. Historical records without these fields are unchanged.

Goal admission cancellation travels through the existing context `signal`, rather
than a separate queue. Canonical Claude checks it after asynchronous preparation
and immediately before native dispatch; raw Claude and Codex goal controls preserve
the same boundary. An abort before dispatch cannot publish a native command, while
an acknowledged command retains its receipt and uses the ordinary stop owner.

`AssistantTranscript` owns the compact error row and Reload action.
`AssistantConversationElement` reuses its avatar space observer to reserve the
warning height for the floating avatar, preserving full-width recovery controls
without putting the avatar into document flow or replacing the transcript.

Claude's native goal attachment precedes its persisted authored `/goal` command,
whose parent UUID points to that sentinel. The history owner retains this exact
command provenance through subsequent evaluations. The bound goal owner waits
boundedly after native admission for its own attachment before publishing a goal
result, preserving Stop and accepted receipts during the wait. Missing evidence
is an accepted-but-pending outcome, not non-delivery or an older goal result.


The native history reader can separately expose original local-command messages
for stopped application repair. It retains their UUID, exact unwrapped text and
explicit command/stdout/stderr provenance. Ordinary history output and native
files are unchanged; the application owns matching, backups and publication.

Claude native goal reads preserve `blocked` when the main history records a
structured `goal_status` evaluation with `met: false, failed: true`, or the
explicit informational event terminating repeated stop-hook attempts. The failed
evaluation means the native evaluator found the goal impossible and removed its
Stop hook; it is not an active goal or a user Pause. The same
goal identity and last evaluator reason remain available across process shutdown.
Quoted assistant text and nested tool events are not evidence of blocking. A
later native goal attachment supersedes the block; a completed goal is not reopened
by a hook notice. Hosts must not automatically resume this blocked state on
restart. This projection records the native termination; it does not prevent
Claude's preceding retry loop or turn an assistant's “paused” reply into a control
operation.

The existing voice queue preserves arrival order for selected progress/thinking
narration and canonical answers. An arriving answer retires only optional murmur
filler, not message playback. Explicit Stop, mute, capture-related narration
retirement and target cleanup retain their existing cancellation owners.
