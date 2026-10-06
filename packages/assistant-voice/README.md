# Assistant voice

Optional duplex voice for Vue 3/Vuetify applications. One shell controller owns
microphone, playback, active destination and modal. Applications retain their
conversations, permissions, message admission and history. No Vibe64 or Genesis
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

Optional defaults: `mode` (`push-to-talk` or `hands-free`), `talkMode` (`tap` or
`hold` for one-off recording), `reviewBeforeSend`, and an installed `voiceId`.
One-off recordings started through `startHeldRecording()` require review; the
modal's push-to-talk gesture uses `reviewBeforeSend`. `avatar` and `onVisual`/`onTranscript`
allow presentation in the surrounding app without adding another audio owner.
The host's `avatar` slot receives state, mouthLevel, mouthPose, avatar and binding.
`useVoiceAvatar` supplies shared animation cues; applications may supply artwork.

## Lifecycle

Opening a target does not start capture. Tap Talk for hands-free, or hold it for
push-to-talk and release to send; connection setup is automatic.
Pause finishes the current utterance, flushing the audio tail before muting.
Completed words follow the captured review policy. Pending delivery does not disable
the microphone: tap can resume the existing continuous capture or start another
one while preserving the prior pending transcript. A busy Pause or hold release
mutes newer capture and finishes it through the original owner after that prior
admission settles. Resuming first keeps the capture open. No pending words are
replaced or appended. The icon reflects actual unmuted capture, not readiness.
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
Keep endpoint and token file server-side. The token grants speech-service use,
not access to a conversation or permission to run an agent. Browsers need a secure
origin (HTTPS or a browser-recognized localhost origin) and microphone permission.

`createVoiceDaemon({ engine, accessKey, ... })` runs the bounded protocol service.
The engine supplies a recognizer, asynchronous synthesis and optionally a public
voice catalogue. A host may supply synchronous `authorize(token)` and
`handleRequest(request, response)` for its own grant policy. An authorized
principal has `tenant` and optional `parentTenant`; both connection quotas apply.
`revokeTenant(id)` ends current child or parent sessions as well as pending work.
The host must reject future requests for revoked grants in its authorizer.

## Example and testing

`examples/conversation/` composes the supplied conversation server integration,
client binding and one shared realtime connection for five file-backed chats.
Text and voice retain the same conversation; an optional headless task uses the
same runtime directly. Its README covers packed-package setup, launch and the
local origin policy. No Vibe64, Genesis or database runtime is required.

Focused package checks run one file at a time, for example:
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
