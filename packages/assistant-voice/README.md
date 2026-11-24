# Assistant voice

Optional duplex voice for Vue 3/Vuetify applications. One shell controller owns
microphone, playback, active destination and modal. Applications retain their
conversations, permissions, message admission and history. No Genesis
runtime is required.

Install `@jskit-ai/assistant-voice` with Vue and Vuetify. Run your own speech
service, or use `@jskit-ai/assistant-voice-sherpa` for local native inference.
The native engine and model downloads are not dependencies of this package.

## Supplied conversation integration

For ordinary conversations, use `AssistantConversationClientElement` from
`@jskit-ai/assistant-runtime/client` with the common conversation runtime. Its
`composer-tools` slot supplies the retained runtime used by the five-chat
`examples/conversation/` starter. That example forwards voice text and Stop through
`runtime.send()` and `runtime.cancel()`, retains the same reader when text closes,
and uses `projectConversationVoiceState` for canonical speech presentation.
Application code supplies the speech endpoint, label and navigation. It needs no
engine-specific imports, separate transcript or conversation connection.

### Custom conversation bindings

Applications with an existing authorized reader can supply the following binding.
Create one controller above routed screens, then mount `VoiceConversationHost`
once within your application's Vuetify app:

```js
import { createVoiceConversationController } from '@jskit-ai/assistant-voice/client';

const controller = createVoiceConversationController({
  connectSpeech: conversation => `/api/conversations/${conversation.id}/voice`
});

await controller.open({ conversation: {
  id: conversationId,
  label: 'Planning',
  get state() { return store.conversations[conversationId]; },
  get available() { return store.canUse(conversationId); },
  captureContext: () => ({ conversationId }),
  submitText: (text, { messageId, context }) =>
    store.send(context.conversationId, { text, messageId }),
  cancelWork: () => store.stop(conversationId)
} });
```

```vue
<VoiceConversationHost :controller="controller" />
```

`state` contains `messages`, optional `streamingReply`, and `status` (`working`
while the agent runs). Messages have stable `id`, `role` and `text`. A streamed
reply and its saved replacement must share the same ID. Only user/assistant
content belongs here; exclude reasoning, tools and private operational output.

`submitText` resolves on canonical acceptance and rejects failures. Preserve its
message ID on uncertain retries and deduplicate in your existing server admission.
The recording's captured context remains fixed across navigation. Update state
from your ordinary reader; voice never owns or reconstructs saved history.

Optional `openText()` opens the application's text conversation. When supplied,
the shared modal shows Talk and Text controls at the top. Selecting Text calls
that operation and minimizes voice; capture and playback keep their current state.
Applications may open voice as their default conversation view without starting
the microphone.

Optional synchronous `retain()` / `release()` keep the conversation reader alive
outside its screen. `available = false` releases the active voice session. Dispose
the controller on app teardown or identity replacement. IDs must include the
identity scope when different people can use the same conversation ID.

Optional defaults: `mode` (`push-to-talk` or `hands-free`), `reviewBeforeSend`,
and an installed `voiceId`.
One-off recordings started through `startHeldRecording()` require review; the
modal's push-to-talk gesture uses `reviewBeforeSend`. `avatar` and `onVisual`/`onTranscript`
allow presentation in the surrounding app without adding another audio owner.
The host's `avatar` slot receives state, mouthLevel, mouthPose, avatar and binding.
`useVoiceAvatar` supplies shared animation cues; applications may supply artwork.
A `still` avatar (`VoiceAvatar`'s `still` prop, or `still: true` given to `useVoiceAvatar`), such as a
thumbnail, never blinks, gestures, cycles expressions or moves its mouth.

## Lifecycle

Opening a target does not start capture. Tap Talk for hands-free, or hold it for
push-to-talk and release to send; connection setup is automatic.
Pause stops new microphone input immediately and retains its buffered audio for
the original final flush before recognition finishes the current utterance.
Completed words follow the captured review policy. Pending delivery does not disable
the microphone: tap can resume the existing continuous capture or start another
one while preserving the prior pending transcript. A busy Pause or hold release
mutes newer capture without discarding its buffered tail and finishes it through
the original owner after that prior admission settles. Resuming first keeps the
capture and its retained tail open. No pending words are
replaced or appended. The icon reflects actual unmuted capture, not readiness.
When the daemon rejects a stale endpoint commit, its exact turn and revision
release only that commit. A waiting Pause can then finalize the same recording;
an obsolete acknowledgement cannot release a newer commit or submit provisional words.
Automatic sends keep the call layout fixed. A failed send exposes the retained
transcript for review and retry with the same message identity. An application
can call `beginTranscriptEdit(messageId)` for its exact unsent preview; this
retains the existing pending transcript and capture destination before cancelling
only capture. `editTranscript(text, messageId)` updates that pending identity and
`deliverTranscript()` keeps the original send/retry owner. Hands-free resumes
through the existing pending-clear watcher after send/discard, not during editing.
An adapter's `previewMessage.actions` may project `editing`, `update(id, text)`,
`send(id)`, `canSend` and `sending` alongside its original ×/edit actions. The
standard transcript uses the same review textarea inside that preview bubble,
including an empty editor, and reuses its existing action row for pending Send.
A matching canonical user with `receipt: false` is still unadmitted: it does not
clear pending words, forbid Edit or acknowledge a speech invitation. Confirmed
readback (an absent flag or `receipt: true`) retains the original identity-based
acknowledgement. For a known failed local delivery, a host can cancel that exact
entry through the original delivery owner only upon explicit Edit, then author
fresh edited text and intent on Send. Plain Retry retains its original payload;
uncertain, accepted and sending entries remain fenced.
When continuous recognition has newer words while an earlier pending send fails,
both identities remain in their original pending/recording owners. Hosts can
project these two existing snapshots through `previewMessages`, deduplicated by
ID, while retaining the singular `previewMessage` contract. `canTakeTranscript(id)`
checks either exact existing identity with the original admission guards. The
newer capture is discardable, but cannot replace the occupied pending editor.
Editing the earlier transcript pauses the newer recording through the original
mute owner, retaining its words, ID, focus and endpoint. Transient
`editPausedCaptureId` on the pending transcript owns only this pause; an explicit
microphone choice supersedes it. Original pending resolution releases only the
matching Edit-owned pause, and the existing endpoint watcher handles newer words.
No additional transcript queue, playback owner or capture process is created.
The app must retain current-target and uncertain-admission guards. Controls use
`reviewInTranscript` only while that preview is projected, suppressing a duplicate
inline review; standalone voice retains its original review fallback. Captions,
review, explicit microphone/sound controls and bounded reconnection share one
session. Opening the same ID reveals it. Switching targets releases the previous
audio first; unfinished words require completion or explicit discard. A pending
send cannot be switched away by the discard action. `minimize()` preserves the
session; `end()` releases it after pending words are resolved. `dispose()` releases
it unconditionally. The controller serializes these operations. The host's X calls `end({ discard: true })`,
so closing stops voice and discards unsent speech. Minus minimizes instead.

`ConversationDialog` provides the same fixed header, icon tabs and bounds for
application Text views, with full screen below 600 pixels and no mode transition.
The backdrop also stays constant during a mode change. The host and shared dialog
accept an optional `activator` DOM element: clicking that covered launcher
minimizes an open conversation instead of closing it.
The host's `reopen` slot lets an application replace the floating reopen control
with its own header indicator and `controller.reveal()` action.

Stop speaking cancels playback and queued speech. Stop agent work calls the app's
separate cancellation operation. Reconnect does not resend audio or messages,
replay history or automatically restart capture. If a service advertises several
voices, the Voice settings cog offers Speaking voice for the next reply's speaker; an in-flight reply keeps
its original speaker through all streamed phrases.

Canonical replies retain the original bounded Markdown cleanup: inspect at most
8,000 raw characters, then speak at most 4,000 normalized characters. A long code
block inside that window does not consume the spoken allowance or hide the answer
after it. Streaming keeps raw source offsets for revision checks; the existing
queue counts normalized consumed prefixes and limits appended text. Reaching the
speech limit ends synthesis, but a completed playback receipt still waits for
the canonical final and actual audio drain. Optional activity narration keeps its
separate original observed-delta limit.

## Server connection

Register an authenticated WebSocket route with Fastify's WebSocket plugin:

```js
import { registerVoiceProxyRoute, resolveVoiceProxyConfig }
  from '@jskit-ai/assistant-voice/server';

registerVoiceProxyRoute(fastify, {
  route: '/api/conversations/:id/voice',
  proxyConfig: resolveVoiceProxyConfig({ endpoint, accessTokenFile }),
  async authorize(request) {
    await checkOrigin(request);
    await requireConversationAccess(request.user, request.params.id);
  }
});
```

The route's authorization is mandatory and runs before upstream connection.
Keep the endpoint and token server-side: `resolveVoiceProxyConfig` takes the
token as `accessTokenFile` (a protected file) or as `accessToken` (its value, for
example from a secret environment variable), one or the other. The token grants
speech-service use, not access to a conversation or permission to run an agent.
Browsers need a secure origin (HTTPS or a browser-recognized localhost origin)
and microphone permission.

## Speech service

The speech service is a service like a database: its host runs it, and each
application is a client of it with its own token. `createVoiceDaemon({ engine,
credentialsFile, ... })` runs the bounded protocol service on a speech engine
(`@jskit-ai/assistant-voice-sherpa`'s, or a stand-in). Its routes:

| Route | Token | Answers |
| --- | --- | --- |
| `GET /health` | none | `ok`, `connections`, `queueDepth`, `startedAt`, `protocolVersion`, `versions` (package and native runtime versions by name) and `credentialsSha256` |
| `GET /v1/catalogue` | yes | `protocolVersion`, `inputSampleRate`, `outputSampleRate`, `recognitionModels` (`id`, `hotwords`), `voices` and `defaultVoice` |
| `GET /voices` | yes | `voices` and `defaultVoice` |
| `/v1/voice` WebSocket | yes | the voice protocol; the voice is chosen per reply |

A client sends `Authorization: Bearer <token>`. The protocol only gains fields;
a change that breaks a client would be `/v2`. `readVoiceServiceCatalogue(config)`
and `readVoiceCatalogue(config)` read the two catalogues with a client's
`resolveVoiceProxyConfig` result.

### Credentials file

The host writes the clients it admits to a JSON file; the service holds only
each token's SHA-256 and never sees a token it did not receive:

```json
{
  "schema": "jskit.assistant-voice.credentials.v1",
  "clients": {
    "crd_mercbot": { "tokenSha256": ["<64 lowercase hex>"] },
    "lnk_ws-12": { "tokenSha256": ["<hex>", "<hex>"], "maximumConnections": 6 }
  }
}
```

- A client name is 1 to 64 lowercase letters, digits, dots, dashes or
  underscores, starting and ending with a letter or digit.
- `tokenSha256` lists 1 to 8 hashes, so a token can be rotated: add the new
  hash, move the client, then remove the old one. A hash is the lowercase hex
  SHA-256 of the token's UTF-8 bytes (`voiceTokenSha256(token)`), and appears
  once in the file. A token is an RFC 6750 bearer token of 32 to 1024
  characters; `createVoiceClientToken()` makes one of 32 random bytes.
- `maximumConnections` replaces the service's per-client limit for that client.
  A client's tokens share one limit.
- Unknown fields are refused (`parseVoiceCredentials(document)` checks a
  document), as are more than 10,000 clients or 4 MiB.

The service checks the file every second (`credentialsPollMs`). Write it
atomically, to a temporary file renamed over it. A change takes effect at once:
a removed token's open sessions are cancelled and closed with
`voice_access_revoked` (1008), and an added client connects without a restart.
`/health`'s `credentialsSha256` is the SHA-256 of the file bytes in use, and
changes only after the revoked sessions have ended, so a host knows the service
runs exactly what it wrote. A rewrite that is not a valid file leaves the last
valid credentials in use; a missing file admits no one (`credentialsSha256` is
`null`). The service does not start without a valid file.

### Access log

`accessLog(record)` receives, by default as one JSON line on standard output:

- one `voice.connection` record per connection: `client`, `startedAt`,
  `endedAt`, `audioSecondsHeard`, `charactersSpoken`, `closed` (`client`,
  `idle`, `revoked`, `shutdown`, `protocol` or `error`) and `closeCode`. A
  refused connection has its record at once, with `closed` `unauthorized`
  (`client` `null`) or `capacity` and nothing heard or spoken. It never holds
  audio or words;
- one `voice.credentials` record when the credentials load, at start and at each
  change: `credentialsSha256`, `clients` and the `clientsAdded`,
  `clientsRemoved` and `clientsChanged` (tokens or limit), and `sessionsEnded`;
- a `voice.credentials.refused` record with the `reason` when a changed file
  cannot be used, and the `credentialsSha256` still in use.

### Capacity

An engine says how many recognitions and syntheses it runs at once
(`engine.concurrency`, default one each). The service synthesizes that many
phrases at once, one per connection at a time, and sizes its limits from it:
`maximumConnections` 8 per recognition worker, `maximumConnectionsPerClient` 2
per recognition worker and `maximumQueuedSpeech` 4 per synthesis worker, each
replaceable. Past them a connection gets 429 and a phrase `busy`.

`@jskit-ai/assistant-voice/stand-in`'s `createStandInSpeechEngine()` is an
engine with no model for tests and catalogue proofs: it hears any audio as
`recognizedText` and speaks silence. Its `versions` name it, so `/health`
shows a stand-in runs.

## Example and testing

`examples/conversation/` composes the supplied conversation server integration,
client binding and one shared realtime connection for five file-backed chats.
Text and voice retain the same conversation; an optional headless task uses the
same runtime directly. Its README covers packed-package setup, launch and the
local origin policy. No Genesis or database runtime is required.

A focused package check names its files, for example:
`npm test --workspace packages/assistant-voice -- test/voiceController.test.js`.
Native speech and physical microphone/speaker testing are separate. Browser echo
cancellation plus local text filters cannot guarantee acoustic isolation on every
device; test hands-free interruption with your actual hardware.

### Application-owned voice preferences

`VoiceConversationHost` has an optional `settings` slot for an application-owned
selector. Persist the voice choice in your application, then supply its current
value through reactive `binding.defaults.voiceId`. Changes apply to subsequent
replies. An unavailable ID uses the server default without rewriting the saved
choice; reconnecting can restore it if the voice returns. An empty string selects
the server default. The built-in selector remains local to the voice session.

`readVoiceCatalogue(proxyConfig)` from `/server` retrieves the daemon's authorized
`GET /voices` metadata without reserving an audio connection. Expose it only
through an application-authorized route; credentials stay on the server. The
result contains `voices` (IDs, labels and optional languages) and `defaultVoice`,
matching the WebSocket greeting. Listing voices does not synthesize or load
additional voice models.


`binding.defaults.reviewBeforeSend` is captured when each recording starts. An
explicit true value holds completed speech for the existing review/Send flow on
both manual finalization and automatic hands-free endpoint completion. A daemon
reset within the same continuous capture retains that choice while creating a
separate message identity; it does not append words to an earlier queued message.
Fresh capture reads fresh defaults. Missing/false retains automatic completed
speech delivery. This flag does not change playback or input ownership.
