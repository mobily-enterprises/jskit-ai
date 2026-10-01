# Assistant voice

Optional duplex voice for Vue 3/Vuetify applications. One shell controller owns
microphone, playback, active destination and modal. Applications retain their
conversations, permissions, message admission and history. No Vibe64 or Genesis
runtime is required.

Install `@jskit-ai/assistant-voice` with Vue and Vuetify. Run your own speech
service, or use `@jskit-ai/assistant-voice-sherpa` for local native inference.
The native engine and model downloads are not dependencies of this package.

## Conversation binding

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
Completed words follow the captured review policy; resume opens a fresh recording.
Automatic sends keep the call layout fixed. A failed send exposes the retained
transcript for review and retry with the same message identity. Captions,
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

`examples/conversation/` is an independent two-conversation application using a
real AI account and speech service. Its README covers installation and launch.

Focused package checks run one file at a time, for example:
`npm test --workspace packages/assistant-voice -- test/voiceController.test.js`.
Native speech and physical microphone/speaker testing are separate. Browser echo
cancellation plus local text filters cannot guarantee acoustic isolation on every
device; test hands-free interruption with your actual hardware.
