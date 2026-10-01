# Independent voice conversation example

This small Vue/Vuetify + Fastify app uses the public voice packages, a real AI
account and a real speech endpoint. Vibe64 and Genesis are not required. Planning
and Notes have separate in-memory histories, while one root voice modal retains
its target independently of which text conversation is visible.

1. Run `npm install` in this directory.
2. Prepare and start a speech service using the assistant-voice-sherpa README.
   Supply the resulting endpoint and tenant token file to this example's server.
3. Run the server (paths below are placeholders for your protected files):

```sh
AI_PROVIDER=deepseek AI_MODEL=deepseek-chat \
AI_API_KEY_FILE=/run/secrets/ai-key \
SPEECH_ENDPOINT=ws://127.0.0.1:3092/v1/voice \
SPEECH_TOKEN_FILE=/run/secrets/example-speech-token npm run server
```

4. In another terminal run `npm run dev` and open `http://127.0.0.1:5176`.
   Type a short request, then open Voice chat, Start voice and try both modes.
   Connect microphone/speakers and grant browser permission yourself.
5. Minimize voice, switch Planning/Notes, and confirm that voice keeps its title
   and original target. Open the other target's Voice chat button to switch it.
   A pending recording requires completion or explicit discard before switching.

`AI_PROVIDER`, `AI_MODEL` and optional `AI_BASE_URL` configure assistant-core's
normal API client. Missing credentials produce an explicit configuration error;
there is no fake assistant fallback. The key remains on the server. The example
stops work through its AbortController and retains stable message IDs for voice
retries. Histories, typed drafts and pending sends are deliberately in memory and
reset on server/page restart; production applications supply their existing store.

The API binds to loopback and accepts writes/voice upgrades only from APP_ORIGIN
(default `http://127.0.0.1:5176`). It is a local single-user example, not a hosted
identity system. A deployed application must provide authenticated, current
conversation authorization in the same proxy and message-handler seams.

Run `npm run build` to check the client build. The example is intentionally small:
server.js owns AI/history/admission, App.vue binds that state to the shared modal,
and the installed packages own audio behavior. No application-specific audio queue,
capture loop, model installer or second voice controller is copied here.
