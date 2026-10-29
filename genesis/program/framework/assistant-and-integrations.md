# Assistants and external integrations

Provides conversation runtimes, provider selection, voice support, reusable
connector account management, and focused third-party operations.

## Sources

- Main: `packages/assistant-core/src/server/conversation/provider.js`
- `packages/assistant-core/src/client/conversation/AssistantTranscript.vue`
- `packages/assistant-core/src/server/conversation/runtimeStateUpgrade.js`
- `packages/assistant-core/src/server/conversation/agentRun.js`
- `packages/assistant-core/src/server/conversation/codexConversationStore.js`
- `packages/assistant-core/src/server/conversation/codexHomeStorage.js`
- `packages/assistant-core/src/server/conversation/continuity.js`
- `packages/assistant-runtime/src/server/AssistantProvider.js`
- `packages/assistant-runtime/src/shared/assistantSurfaces.js`
- `packages/assistant-voice/src/server/index.js`
- `packages/connectors-core/src/server/ConnectorsFeature.js`
- `packages/connectors-catalog/src/shared/definitions.js`

## Public contract

Applications select supported assistant and connector providers, retain their
own conversation and connection identities, and supply credentials through
server-side environment references. Conversations preserve provider lifecycle,
streaming, attachment, recovery, and storage contracts. Connector operations
remain scoped to the application and user or workspace that owns the account.

An assistant surface's configuration alone decides whether its runtime route has
a workspace segment, so HTTP requests and realtime subscriptions always name the
same route; a workspace slug supplied for a surface without workspaces is
ignored. Client runtime code names no application surface. Assistant-core owns
the attachment-ID limits (ten distinct, nonempty IDs of at most 256 characters):
its schema field, server check, continuity resolver batches and composer default
are the single definition that the assistant runtime reuses for its request
bodies and pre-admission check.

Realtime subscription setup checks its original socket-owned liveness between
opening, observer attachment and snapshot reading. Released setup cannot start
the next phase; late observers are detached without affecting a replacement or
stopping model work. Reload still performs fresh authorization, and reads already
in flight remain unable to acknowledge into a replacement view.

The existing native changeover owner can bound quoted history by UTF-8 JSON
bytes, selecting all messages when a finite budget replaces its initial message
window. Initial and returning catch-up drop complete oldest rows to fit without
editing saved history or summarising it. Removed identities and exact pending
receipt/retry contents remain authoritative. Callers own destination budget
selection; a byte limit neither estimates tokens nor changes model settings.
An async budget resolver runs only for new catch-up, after pending-delivery
inspection; exact retries and ordinary messages do not repeat native preparation.
The Codex configuration owner reads the exact runtime catalogue's normal model
window and effective percentage. Extended maximum windows are not used as
transfer limits. Missing or ambiguous model facts fail without leaking private
catalogue contents; existing thread usage remains a separate input.

Every Codex process JSKIT launches, the shared app-server for main and Helper
work and a local interactive terminal, starts with `features.plugins=false` and
`features.apps=false`. Codex would otherwise sync the openai/plugins repository
and plugin, app and connector catalogues into its home at start (about
100-250 MB per home, never pruned) that no JSKIT conversation uses; a remote
terminal inherits its app-server's setting. `codexHomeDisposablePaths(codexHome)`
lists what those features left in a home, and with `{ retired: true }` the
runtime-only data (diagnostic log database, `.tmp`, `cache`, `tmp`) of a home
that will not launch again. It never follows links, reads no content and keeps
auth, config, catalogue, sessions and state databases; hosts remove the listed
paths only while no Codex process uses the home.

A bound native conversation may supply that budget resolver directly. The
common runtime adds fresh authorization and cancellation checks and selects all
history unless the host retains an explicit initial message window. The original
Claude owner reads model-specific context usage through its existing native
process without sending an inference request; host policy reserves working space.

The runtime keeps one open entry for each bound namespace. A logical conversation
that a host binds through its own commands leaves memory when that host deletes
or archives it and calls `retireOpenConversation`: its handles and listeners
close, a missing entry is not opened, and native or storage-owned conversations
keep their own disposal. The runtime's live streams are kept per conversation id;
a logical conversation streams through its own owner, so retiring it never
clears the live stream of another entry with the same id.

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
native owners mark acknowledgement before receipt persistence. Hosts declare
the names of their own preparation marks through `hostDeliveryStages`; the
runtime knows none of them. Observer work does not block dispatch or alter saved
conversation data.

Claude status reads and ordinary Main steering retain the active process's instruction installation;
changed host guidance is applied at the next idle admission. Account identity is
checked before delivery and by idle status reads; a status read during a running
turn keeps that turn on its account. Explicit settings changes retain their guards.

When a Claude process ends without being stopped, its stream failure waits up to
five seconds for the execution host's exit report. The person-facing failure then
names the cause: a recorded process/thread-limit denial, a terminating signal or
the exit code, and says the saved conversation continues with the next message.

Claude's native turn owner follows automatic task-notification continuations and
the complete live background-task inventory. Non-ambient native work keeps the
conversation active, including Bash and remote tasks; repeated status events do
not complete the same activity twice. Steering after the main loop has finished
does not wait for another interrupt result from that finished loop. Active-turn
steering and goal Set/Resume write the new input as a plain user message and
never interrupt: Claude Code queues it and reads it only when the running tool
call returns. So that a long foreground command or wait loop cannot hold the
person's message for minutes, each steer sends Claude's `background_tasks`
control (the Ctrl+B equivalent) after its write, and again whenever a task
starts before Claude reads it. Foreground Bash commands and subagents then keep
running in the background and report completion, the blocked tool call returns,
and Claude reads the steer at its next step. Background workers continue. A
refused control leaves the steer waiting for the tool call and is reported as the
`steering_background_failed` diagnostic. One native result can finish every
input Claude has started reading. Explicit Stop is the only
interrupt and retains its cancellation behavior. The retained
host receives normalized continuation and diagnostic events without prompt or
response contents, and continues to own persistence and operator logging.
Older completion checkpoints cannot overwrite a newer native continuation.
Removing a completed worker from the native inventory invalidates the preceding
foreground result as completion evidence. The main model must finish consuming
that worker's notification before the shared run releases its admitted application
tools. This applies when inventory replacement or a task update arrives before
the notification itself; explicit Stop still uses the original cleanup owner.
Split native text keeps its live output identity until the API message identifies
it as tool commentary or an answer; restored history uses the same classification.
Scoped Claude output also keeps its native input identity across accepted steering.
The native reader resolves that identity against saved authored request IDs, and
the existing transcript writer attaches partial and final output to that exact
turn. An unmatched identified output cannot fall back to the latest request.
Verified Stop also retains buffered or streaming partial text as commentary for
the existing transcript reader; unconfirmed cleanup leaves the stream incomplete.
This preserves displayed work without claiming a completed answer.
Native history's explicit API block index identifies a saved frame and its live
fragment as the same output. A Stop/read race retains that block once, as
commentary after verified interruption. Scoped transcript admission checks both
saved message IDs and existing output IDs, so a later history read cannot append
the same block again under its frame UUID. Existing history is not rewritten.
The shared native block reader excludes Claude's non-error `<synthetic>`
single-text `No response requested.` placeholder, following the CLI's own
classification. Live events and cold history use the same rule; actual model
replies, native API errors and other synthetic command output remain intact.
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
The optional initialization progress observer reports request creation, completed
pipe write and the matching control response separately. It receives only fixed
stage names; observer failures cannot change protocol completion or cleanup.
Write completion and response arrival may occur in either order, and both remain
required for successful initialization.
Account queries deduplicate by account identity, and invalidation cancels held
startup and reads before awaiting their owned cleanup. Borrowed conversations
remain owned by their original lifecycle. Requests also retain the invalidation
revision across account lookup and retained cleanup: an older request cannot
launch a successor process or refill the cache after reconnection. Native
storage inventory and retirement borrow the shared Codex or OpenCode process
without becoming a user: it stops about a minute after the last storage read
unless a conversation, terminal or helper uses it. Codex Temporary chats borrow
the same way. Reading their history or status, creating, stopping or deleting
them and changing a thread's settings keep no app-server running; a running turn,
or an active goal between its turns, holds it, and about a minute after that
work ends it stops unless a Main conversation, terminal or helper claimed it.

Claude's conversation owner cleans up from the entries it retains, because a
Claude process cannot outlive the server that started it. Shutdown,
provider-connection changes, project close, renewal proof release and the
temporary-activity check reopen no saved conversation. They stop only
entries holding native work, write nothing for idle ones and handle sessions
concurrently; a failing session is reported by ID while the others still stop.
Project close and proof release also forget the session's entries. A session
close additionally reopens only saved custody an earlier server left (an
unproven execution or a turn saved as active) so a verified stop can retire
it; once shutdown is closing the owner, it reopens nothing.

A Claude account change (sign-in, sign-out or switching accounts) stops and
waits on nothing: it only drops the account's cached model and usage reads.
Claude Code reads its credentials for every request, so a running turn continues
on the newly connected account, and after a sign-out its next request ends at
once with Claude Code's "Not logged in" result, reported as "Claude isn't
connected. Sign in to Claude, then send your message again." Each conversation
applies its account guard at its next idle admission.

The Claude model list is kept per owner for the account that gave it, until
that account's `.credentials.json` or the Claude Code executable that answered
changes (file metadata, following links): sign-in, sign-out and each token
refresh, which also carries a plan change, rewrite the credentials, and an
update replaces the executable. Reading it again therefore starts no Claude
however often pages reconnect or return. When it must be read, a temporary
query process answers, never a live conversation's process, whose list dates
from its own start. An executable given as a bare name has no metadata, so
only an account or credentials change refreshes its list; macOS keeps
credentials in the Keychain, so there an account change or update does.

Claude plan usage keeps one verified reading per account in the server process,
shared by every account-query owner, page and session that asks for that
account; a request that arrives during a read shares it. A live conversation
process of the asking owner answers at most once a minute per account; without
one, or when its answer is unverified, a temporary query process answers only
when neither a verified reading nor a temporary read is from the last five
minutes, and is stopped after its read. However many pages poll, an account
therefore starts at most one temporary Claude every five minutes, and none while
no page asks. Claude Code holds a refused endpoint read per process, so the fresh
process can still reach the endpoint. An account change forgets the readings the
owner used, so the next request reads again.
Claude Code answers from the usage endpoint with its `limits` list, or, while
that read fails or is held, from the answering process's last response headers
without `limits` or any age. Only the first kind replaces the reading. It is
`available` with `currentForMs` for seven minutes after `checkedAt`, then
`stale`; with no verified reading it is `unavailable`.

Claude goal creation and resumption use ordinary native message admission,
including steering while a turn is active. A new goal cannot replace an
unfinished goal; turn activity alone does not require cancellation.
The native history reader also recognizes a successful `goal clear` command
whose native stdout is `No goal set`: an impossible-goal evaluation may already
have removed the live goal without writing a clearing attachment. That explicit
command receipt clears the historical projection on subsequent reads. Model
prose, nested commands and stderr cannot clear a goal; native history is unchanged.
Its native parent user UUID supplies the exact cancellation acknowledgement,
so the accepted command does not wait for a clearing attachment that will not arrive.
Background-only steering retires the prior completion before host preparation,
so a task finishing during preparation cannot close the pending follow-up.
An application-owned account preparation may opt into following its current
authorized native account with `allowAccountChange`. Verified old-process cleanup
precedes identity persistence and same-history resume; standalone bindings retain
the default changed-account refusal. The standalone Claude driver exposes this
existing policy through the trusted `host.allowAccountChange` option. Completed
response inspection always keeps its original account pin, even for an opted-in
host; no past application effect acquires the replacement identity.

The shared goal control uses canonical conversation working status for activity
animation, independently of active goal scheduling. Provider-supplied elapsed
usage remains running time; when only goal creation timestamps are available it
explicitly labels wall elapsed time including pauses. Recovery actions precede
long objective and reason text. Accepted Set closes the menu and clears its
draft; rejected or uncertain results retain both for recovery. A delivery check
that confirms the same goal request was accepted clears its stale command error
without submitting another goal.
The objective input stops growing after four rows and scrolls its remaining text.
The menu stays within the viewport, retaining its existing scroll behavior so
long objectives cannot push Start outside the visible panel.

The retained browser goal binding distinguishes an unknown goal from a confirmed
empty goal. Initial and replacement reads display loading; failed reads hide
stale actions and report unavailability. Starting, pausing, resuming and cancelling
labels describe the actual command, not a background read or message admission.
An available host goal view can also carry a recovery error. The shared goal
state displays it without disabling the same-read target or Resume controls.
Pause and Cancel never depend on chat delivery: they go straight to the goal
operation, pinned to the goal they stop, while a message is sending or its
receipt is unknown (a message-delivered Cancel keeps its receipt identity).
`stopPending` disables only them, for another goal command or an unavailable
goal or conversation; Set and Resume still wait for sending and uncertainty.
Cancel on a pending, uncertain or failed message is decided by the server.
The runtime aborts its unsent request and running delivery check, shows the
message as Cancelling… and calls `POST …/deliveries/:messageId/cancel`. It
removes the message only when the server agrees; when the server cannot be
reached the message stays with Cancel again and is retried on the next snapshot.
The runtime's own `cancelDelivery` never waits for the conversation queue. It
records the message in the open conversation's bounded cancelled set at once,
stops a submission holding that message, and answers. A send of that message
still queued, or arriving later, is refused in `admitSend` as
`conversation_message_cancelled` (not sent; the client treats it as a definite
rejection). Discarding its unconfirmed request or pending changeover attempt
(`continuity` `discard`) runs afterwards in queue order. An application
conversation supplies its own `cancelDelivery`.
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

Closing a Codex session or project stops its live conversations first, each
through the provider that observes it; one that cannot stop stays registered for
a retried close while the others still stop. Saved Helper records are restored
only to be retired through the providers that close stops. A record that cannot
be restored (a removed account, an unreadable ledger, a notice its host refuses)
stays on disk for a later connection and is reported, and never keeps providers
running. Project close then stops every provider of the project's sessions,
including one only a Temporary chat or a read used. Account-change invalidation
does not reopen saved records. Deleting a
scoped Helper never starts a Codex app-server: its ephemeral thread lived only
in the process that created it, so the delete stops only this server's live
providers for the scope and any runtime whose earlier stop could not prove exit.
Codex thread inventories bound the thread IDs they keep, not the preview text
they discard, and a refused inventory names its check and thread. An OpenCode
server that exits before readiness names its last stderr line, and a deleted
scoped OpenCode conversation keeps no exit proof.
OpenCode turn reads (completion, admission, application tool ownership) find
their input through native history pages: `readOpenCodeMessagesUntil` follows
the native older-page cursor until the input is seen, so a turn with more model
steps than one page still completes and is not dispatched again.
OpenCode applies an agent's last matching permission rule, so a guarded agent's
`"*": "ask"` restates two denials: an agent without application tools is not
offered the discovery tools, and no agent waits for the unanswerable
repeated-call approval. A model that keeps calling refused native tools ends its
turn with a visible failure, through the same stop path as an exceeded output
limit.
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
The existing clipped artwork wrapper contains layout and paint, limiting animated
SVG invalidation to its reserved region while retaining the supplied animation,
voice controls and responsive size clamp.

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

An explicitly configured Claude application-tool process installs its SDK control
handler even when a native goal starts it before the first authored tool-bearing
turn. Native execution still requires the same current admitted tool identity.
Self-pause reuses the original native goal/cleanup owner; the shared runtime
retains the successful application-tool receipt and admits a later ordinary
request. Host continuation intent and permission remain application-owned.

The existing Claude goal owner marks its own pre-dispatch validation failures
as `conversation_invalid_goal`, HTTP 400 and `delivery: "not-sent"`. The shared
client then retains a failed attempt without requiring delivery inspection.
The original send owner also marks failed process preparation as `delivery:
"not-sent"`: starting or resuming the process has not written the new authored
input. The same message can be explicitly retried after preparation recovers.
Failures after the native input write keep their original acknowledgement and
uncertain-delivery behavior; the preparation catch does not wrap those effects.

The existing Claude account-query factory receives the bounded `purpose` value
`catalogue` or `usage` for temporary process startup diagnostics. Borrowed
conversation processes, account caches, cancellation and cleanup remain owned
by the same query facility; the label does not change their lifecycle.

`readClaudeCodeAuthStatus` keeps one entry per account (its configuration
root, credential home and Claude identity variables), shared by every host
runner and command path that reads it, and keeps Claude's answer until
`.credentials.json`'s metadata changes. Sign-in writes that file, sign-out
removes it and a token refresh rewrites it; `.claude.json`, which Claude Code
rewrites during turns and after every status run, is not watched. A read that
ran and failed is reported and asked again next time. A read the host timed out
or refused for now (`timedOut` or `retryable`) is reported and reused for 30
seconds, so a busy host is not probed again by every caller. macOS reuses
nothing because file metadata cannot show Keychain changes.

The existing voice queue preserves arrival order for selected progress/thinking
narration and canonical answers. An arriving answer retires only optional murmur
filler, not message playback. Explicit Stop, mute, capture-related narration
retirement and target cleanup retain their existing cancellation owners.


Claude Pause now retains its exact objective and native identity in the original
conversation record. The existing process owner sends and verifies the native
local clear command before admitting another input, preventing automatic checker
restoration on ordinary messages or restart. Resume reinstalls the retained goal;
Cancel removes it only after the matching native receipt. This adds no scheduler
and never infers goal changes from model prose.


The same Claude goal owner accepts an admitted native `block` control with the
exact goal identity and a nonempty reason of at most 1,000 characters. It stores
`blockedGoal` alongside the existing optional `pausedGoal` (never both), stops
native execution and disarms the checker before ordinary input. Hosts must
round-trip both optional fields. Resume and Cancel clear retained state only
after their exact native command receipt. Host application tools decide who may
report an external blocker; this owner does not interpret message prose or
schedule retries. Blocked status and reason survive owner recreation.


The shared goal control accepts `pauseBlocked` from a consumer whose provider
can explicitly pause blocked goals. Pause and Resume are independent controls
in that state; Claude uses the existing retained-goal Pause owner without
resuming native work.
