import assert from "node:assert/strict";
import test from "node:test";
import * as vue from "vue";
import { useVoiceConversation } from "../src/client/voiceConversation.js";

async function fixture(t, { slowStart = false, failSend = false } = {}) {
  let releaseStart;
  let cancelled = false;
  const calls = { sends: [], playback: 0, cancels: 0 };
  const voice = {
    availableVoices: vue.ref([]), selectedVoice: vue.ref(""),
    reconnecting: vue.ref(false), endpoint: vue.ref(null), completedUtterance: vue.ref(null), utteranceReset: vue.ref(null), utteranceStale: vue.ref(null), canAppendSpeech: vue.ref(false),
    microphoneMuted: vue.ref(false), setMicrophoneMuted(value) { voice.microphoneMuted.value = value; },
    captureState: vue.ref("idle"), transcript: vue.ref(""), partialTranscript: vue.ref(""), error: vue.ref(""),
    activeSpeechTurnId: vue.ref(""), speaking: vue.ref(false), inputLevel: vue.ref(0), mouthLevel: vue.ref(0), mouthPose: vue.ref("rest"),
    async startListening() {
      cancelled = false;
      voice.captureState.value = "opening";
      if (slowStart) await new Promise(resolve => { releaseStart = resolve; });
      if (cancelled) return false;
      voice.captureState.value = "listening";
      return true;
    },
    async stopListening() { voice.captureState.value = "transcribing"; },
    async cancelListening() { cancelled = true; calls.cancels++; voice.captureState.value = "idle"; },
    async preparePlayback() { calls.playback++; }, stopSpeaking() {}, async speak() {},
    async close() { await voice.cancelListening(); }, finishCurrentPhrase() {}
  };
  voice.listening = vue.computed(() => voice.captureState.value === "listening");
  const props = vue.reactive({ conversation: { conversationId: "colleague", messages: [] }, focus: { projectSlug: "alpha", sessionId: "session-a" },
    submit: async (text, options) => { calls.sends.push({ text, ...options }); if (failSend) throw new Error("Connection lost"); } });
  const scope = vue.effectScope(true);
  const binding = { id: "conversation", label: "Assistant", state: props.conversation,
    captureContext: () => ({ ...props.focus }),
    submitText: (text, { messageId, context }) => props.submit(text, { messageId, focus: context }) };
  const state = scope.run(() => useVoiceConversation(binding, { socketUrl: "/voice", createTransport: () => voice }));
  t.after(async () => { await state.close(); scope.stop(); });
  return { state, voice, props, calls, releaseStart: () => releaseStart(),
    async transcript(text) { voice.transcript.value = text; voice.captureState.value = "idle"; await vue.nextTick(); } };
}

test("hold release retains text for explicit Send and preserves the recording's destination", async t => {
  const f = await fixture(t);
  await f.state.startHeldRecording();
  assert.equal(f.state.heldReview.value, true);
  assert.equal(f.calls.playback, 0);
  f.props.focus = { projectSlug: "beta", sessionId: "session-b" };
  await f.state.finishHeldRecording();
  await f.transcript("Please inspect this project.");
  assert.equal(f.calls.sends.length, 0);
  assert.equal(f.state.pendingTranscript.value.text, "Please inspect this project.");
  await Promise.all([f.state.deliverTranscript(), f.state.deliverTranscript()]);
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.calls.sends[0].focus.projectSlug, "alpha");
  assert.equal(f.state.heldReview.value, false);
});

test("Discard removes the transcript without sending; late results remain discarded", async t => {
  const f = await fixture(t);
  await f.state.startHeldRecording();
  await f.state.finishHeldRecording();
  await f.state.discardHeldRecording();
  await f.transcript("A late transcript.");
  assert.equal(f.calls.sends.length, 0);
  assert.equal(f.state.pendingTranscript.value, null);
  assert.equal(f.state.heldReview.value, false);
});

test("releasing while the microphone opens cancels that pending capture", async t => {
  const f = await fixture(t, { slowStart: true });
  const starting = f.state.startHeldRecording();
  await f.state.finishHeldRecording();
  f.releaseStart();
  await starting;
  assert.equal(f.voice.captureState.value, "idle");
  assert.equal(f.calls.cancels, 1);
  assert.equal(f.calls.sends.length, 0);
});

test("failed Send keeps the reviewed text and uses the same identity on retry", async t => {
  const f = await fixture(t, { failSend: true });
  await f.state.startHeldRecording();
  await f.state.finishHeldRecording();
  await f.transcript("Keep this message.");
  await f.state.deliverTranscript();
  assert.equal(f.state.heldReview.value, true);
  assert.equal(f.state.pendingTranscript.value.text, "Keep this message.");
  await f.state.deliverTranscript();
  assert.equal(f.calls.sends[0].messageId, f.calls.sends[1].messageId);
});

test("push-to-talk belongs to the pointer or key that started recording", async t => {
  const f = await fixture(t);
  f.state.live.value = true;
  const press = { pointerId: 1, button: 0, currentTarget: { setPointerCapture() {} } };
  await f.state.startPushToTalk(press);
  await f.state.finishPushToTalk({ pointerId: 2 });
  await f.state.cancelPushToTalk({ pointerId: 2 });
  await f.state.finishPushToTalk({ key: " " });
  assert.equal(f.voice.captureState.value, "listening");
  assert.equal(f.state.pushHolding.value, true);
  await f.state.finishPushToTalk(press);
  assert.equal(f.voice.captureState.value, "transcribing");
  await f.state.discardHeldRecording();
  await f.state.startPushToTalk({ key: " " });
  await f.state.finishPushToTalk({ key: "Enter" });
  assert.equal(f.voice.captureState.value, "listening");
  await f.state.cancelPushToTalk({ type: "blur" });
  assert.equal(f.voice.captureState.value, "idle");
});
