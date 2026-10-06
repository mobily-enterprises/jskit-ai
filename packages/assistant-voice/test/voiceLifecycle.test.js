import assert from "node:assert/strict";
import test from "node:test";
import * as vue from "vue";
import { useVoiceTransport } from "../src/client/voiceTransport.js";
import { useVoiceConversation } from "../src/client/voiceConversation.js";
import { projectConversationVoiceState } from "../src/client/conversationVoiceState.js";

function mountSetup(setup, router) {
  let value;
  let mounted = true;
  const renderer = vue.createRenderer({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({
    setup() { value = setup(); return () => null; }
  });
  if (router) app.use(router);
  app.mount({});
  return {
    value,
    unmount() {
      if (!mounted) return;
      mounted = false;
      app.unmount();
    }
  };
}

function mountVoice(t, { autoReady = true, colleague = false, callMode = "hands-free", speechEnabled = false, voiceOptions = {}, defaults = {} } = {}) {
  const media = [];
  const contexts = [];
  const worklets = [];
  const sockets = [];
  const starts = [];
  const notices = [];
  const emitted = [];
  const buffers = [];
  const sources = [];
  const animationFrames = new Map();
  let nextAnimationFrame = 0;
  const connectedNode = () => ({ connect() {}, disconnect() {} });
  class ControlledAudioContext {
    constructor(options) {
      this.sampleRate = options.sampleRate || 48_000;
      this.currentTime = 0;
      this.resumeCalls = 0;
      this.state = "suspended";
      this.destination = {};
      this.audioWorklet = { async addModule() {} };
      contexts.push(this);
    }
    async resume() {
      this.resumeCalls += 1;
      const pending = this.nextResume;
      this.nextResume = null;
      if (pending) await pending;
      if (this.state !== "closed") this.state = "running";
    }
    async close() { this.state = "closed"; }
    createGain() { return { ...connectedNode(), gain: { value: 1 } }; }
    createAnalyser() {
      return {
        ...connectedNode(), fftSize: 1024,
        getFloatTimeDomainData(samples) { samples.fill(0); },
        getByteFrequencyData(samples) { samples.fill(0); }
      };
    }
    createMediaStreamSource(stream) { this.stream = stream; return connectedNode(); }
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1);
      const buffer = {
        duration: length / sampleRate,
        samples: new Float32Array(length),
        copyToChannel(samples, channel) { assert.equal(channel, 0); this.samples.set(samples); }
      };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const context = this;
      const source = {
        stopped: false,
        disconnected: false,
        onended: null,
        connect() {},
        disconnect() { this.disconnected = true; },
        start(at) { this.startedAt = at; },
        stop() { this.stopped = true; },
        finish() {
          if (!this.stopped) context.currentTime = Math.max(context.currentTime, this.startedAt + this.buffer.duration);
          this.onended?.();
        }
      };
      sources.push(source);
      return source;
    }
  }
  class ControlledWorklet {
    constructor(context) {
      this.context = context;
      this.holdFlush = false;
      this.flushRequested = false;
      this.port = {
        onmessage: null,
        postMessage: (message) => {
          if (message.type === "mute") { this.muted = message.muted; return; }
          assert.deepEqual(message, { type: "flush" });
          this.flushRequested = true;
          if (!this.holdFlush) queueMicrotask(() => this.finishFlush());
        }
      };
      worklets.push(this);
    }
    connect() {}
    disconnect() {}
    emit(data) { this.port.onmessage?.({ data }); }
    finishFlush(samples) {
      if (samples) this.emit(samples);
      this.emit({ type: "flushed" });
    }
  }
  class ControlledSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        if (autoReady && this.readyState === 0) this.ready();
      });
    }
    ready() {
      this.readyState = 1;
      this.receive({ type: "voice.ready" });
    }
    receive(message) {
      this.dispatchEvent(new MessageEvent("message", {
        data: message instanceof ArrayBuffer ? message : JSON.stringify(message)
      }));
    }
    send(payload) {
      assert.equal(this.readyState, 1, "the controlled transport only accepts sends while open");
      this.sent.push(payload);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.dispatchEvent(new Event("close")));
    }
  }
  const restoreGlobals = installGlobals({
    location: { href: "http://voice.test/" },
    window: Object.assign(new EventTarget(), { AudioContext: ControlledAudioContext }),
    requestAnimationFrame(callback) { const id = ++nextAnimationFrame; animationFrames.set(id, callback); return id; },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    AudioWorkletNode: ControlledWorklet,
    WebSocket: ControlledSocket,
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          const pending = Promise.withResolvers();
          const request = {
            constraints,
            stops: 0,
            settled: false,
            track: { enabled: true, stop: () => { request.stops += 1; } },
            stream: { getTracks: () => [request.track] },
            resolve() { this.settled = true; pending.resolve(this.stream); },
            reject(error) { this.settled = true; pending.reject(error); }
          };
          media.push(request);
          return pending.promise;
        }
      }
    }
  });
  let view;
  t.after(async () => {
    try {
      for (const worklet of worklets) {
        worklet.holdFlush = false;
        if (worklet.flushRequested) worklet.finishFlush();
      }
      view?.unmount();
      for (const request of media) if (!request.settled) request.resolve();
      await Promise.all(starts);
      await flushVue();
    } finally {
      restoreGlobals();
    }
  });
  const sessionId = vue.ref("session-a");
  const voiceModule = { useVibe64OnlineVoice: useVoiceTransport };
  let voice;
  const colleagueProps = vue.reactive({ defaults, conversation: { conversationId: "colleague", messages: [], status: "ready" },
    focus: { projectSlug: "example", sessionId: "session-a" }, submit: async () => {} });
  view = mountSetup(() => {
    if (colleague) {
      const state = useVoiceConversation({ id: "conversation", label: "Assistant", state: colleagueProps.conversation,
        get defaults() { return colleagueProps.defaults; },
        captureContext: () => ({ ...colleagueProps.focus }),
        submitText: (text, { messageId, context }) => colleagueProps.submit(text, { messageId, focus: context }),
        onError: message => notices.push({ message, intent: "action-feedback" }),
        conversationId: "logical-conversation",
        onPlayback: value => { emitted.push(["playback", value]); return colleagueProps.onPlayback?.(value); },
        onReadAloudChange: value => { emitted.push(["readAloud", value]); return colleagueProps.onReadAloudChange?.(value); },
        onTranscript: (value, metadata) => emitted.push(["transcript", value, metadata]), onVisual: value => emitted.push(["visual", value])
      }, { socketUrl: "/voice" });
      if (callMode) state.callMode.value = callMode;
      voice = state.voice;
      return state;
    }
    voice = useVoiceTransport({ socketUrl: voiceOptions.socketPath || (() => `/voice/${sessionId.value}`),
      interruptSpeechOnListen: true, speechEnabled, ...voiceOptions });
    return voice;
  });
  return {
    media, contexts, worklets, sockets, buffers, sources, sessionId, voice, notices, emitted,
    advancePlayback(time) {
      contexts[0].currentTime = time;
      for (const [id, callback] of [...animationFrames]) { animationFrames.delete(id); callback(); }
    },
    colleague: colleague ? view.value : null, colleagueProps, unmount: view.unmount,
    anotherVoice() {
      const another = mountSetup(() => voiceModule.useVibe64OnlineVoice({ socketUrl: "/voice/other" }));
      t.after(another.unmount);
      return another.value;
    },
    speak(text, turnId) {
      const starting = voice.speak(text, turnId).then((value) => ({ value }), (error) => ({ error }));
      starts.push(starting);
      return starting;
    },
    start() {
      // Capture rejected starts immediately so failing baseline assertions can
      // still tear down every deferred permission request without unhandled rejections.
      const starting = voice.startListening().then((value) => ({ value }), (error) => ({ error }));
      starts.push(starting);
      return starting;
    }
  };
}

function controls(socket) {
  return socket.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item));
}

function installGlobals(values) {
  const originals = Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

async function flushVue() {
  await vue.nextTick();
  await new Promise(setImmediate);
  await vue.nextTick();
}


test("Colleague can listen during speech and retain its connection across project/session selection", async (t) => {
  const view = mountVoice(t, { speechEnabled: true, voiceOptions: {
    socketPath: "/api/vibe64/colleague/voice/ws", interruptSpeechOnListen: false
  } });
  await view.speak("We can discuss this while I speak.", "speech-1");
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "speech-1", sampleRate: 22050 });
  socket.receive(new Int16Array([1, 2, 3]).buffer);
  await flushVue();
  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await starting, { value: true });
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.voice.speaking.value, true);
  assert.equal(view.voice.activeSpeechTurnId.value, "speech-1");
  assert.equal(view.sources[0].stopped, false);
  assert.equal(controls(socket).some(({ type }) => type === "cancel"), false);
  view.sessionId.value = "another-session";
  await flushVue();
  assert.equal(socket.readyState, 1);
  assert.equal(view.sockets.length, 1);
  assert.equal(view.media[0].stops, 0);
  view.voice.stopSpeaking();
  assert.equal(view.voice.listening.value, true, "Stop speaking must leave capture running");
  assert.equal(view.voice.activeSpeechTurnId.value, "");
  assert.equal(view.sources[0].stopped, true);
  assert.deepEqual(controls(socket).filter(({ type }) => type === "cancel"), [{ type: "cancel", turnId: "speech-1" }]);
  const listenId = view.voice.activeListenTurnId.value;
  await view.voice.stopListening();
  socket.receive({ type: "transcript.final", turnId: listenId, text: "Please change the next step." });
  assert.equal(view.voice.transcript.value, "Please change the next step.");
  assert.equal(view.voice.state.value, "idle");
});

test("finishing either Colleague audio direction does not retire the other", async (t) => {
  const view = mountVoice(t, { speechEnabled: true, voiceOptions: {
    socketPath: "/api/vibe64/colleague/voice/ws", interruptSpeechOnListen: false
  } });
  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  await starting;
  const socket = view.sockets[0];
  await view.speak("First answer", "speech-1");
  socket.receive({ type: "speech.start", turnId: "speech-1" });
  socket.receive({ type: "speech.end", turnId: "speech-1" });
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.voice.state.value, "listening");
  await view.speak("Second answer", "speech-2");
  socket.receive({ type: "speech.start", turnId: "speech-2" });
  assert.equal(view.voice.speaking.value, false, "accepting synthesis is not audible speech");
  socket.receive(new Int16Array([1, 2]).buffer);
  await flushVue();
  const turnId = view.voice.activeListenTurnId.value;
  await view.voice.stopListening();
  socket.receive({ type: "transcript.final", turnId, text: "Keep talking" });
  assert.equal(view.voice.speaking.value, true);
  assert.equal(view.voice.activeSpeechTurnId.value, "speech-2");
  assert.equal(view.voice.state.value, "speaking");
});

test("Colleague queues spoken answers independently of steering and drains actual playback", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const colleague = view.colleague;
  view.colleagueProps.conversation.messages = [{ id: "old", role: "assistant", text: "Old reply." }];
  await flushVue();
  await colleague.toggleReadAloud();
  assert.equal(view.sockets.length, 0, "enabling speech does not replay old replies");
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
    { id: "one", role: "assistant", text: "First reply." }, { id: "two", role: "assistant", text: "Second reply." }];
  await flushVue();
  const socket = view.sockets[0];
  const first = controls(socket).find(({ type }) => type === "speak.start");
  socket.receive({ type: "speech.start", turnId: first.turnId });
  socket.receive(new Int16Array([1, 2, 3]).buffer);
  socket.receive({ type: "speech.end", turnId: first.turnId });
  view.colleagueProps.conversation.status = "working";
  view.colleagueProps.focus = { projectSlug: "another-project" };
  await flushVue();
  assert.equal(view.voice.activeSpeechTurnId.value, first.turnId);
  assert.equal(controls(socket).filter(({ type }) => type === "speak.start").length, 1);
  view.sources[0].finish();
  await flushVue();
  assert.deepEqual(controls(socket).filter(({ type }) => type === "speak.start").map(({ text }) => text), ["First reply.", "Second reply."]);
  colleague.stopSpeech();
  await flushVue();
  assert.equal(view.voice.activeSpeechTurnId.value, "");
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages];
  await flushVue();
  assert.equal(controls(socket).filter(({ type }) => type === "speak.start").length, 2, "stopped/repolled replies stay retired");
});

test("stopped Colleague speech ignores delayed user history until a new local request is admitted", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  view.colleagueProps.conversation.messages = [{ id: "answer-a", role: "assistant", text: "First reply." }];
  await flushVue();
  const socket = view.sockets[0];
  view.colleague.stopSpeech();
  const lateHistory = [
    { id: "user-a", role: "user", text: "An earlier question" },
    ...view.colleagueProps.conversation.messages,
    { id: "notice-a", role: "assistant", text: "A delayed update." }
  ];
  view.colleagueProps.conversation.messages = lateHistory;
  await flushVue();
  assert.equal(controls(socket).filter(({ type }) => type === "speak.start").length, 1);
  view.colleague.inviteSpeech("user-b");
  view.colleagueProps.conversation.messages = [...lateHistory,
    { id: "notice-b", role: "assistant", text: "Another old update." }];
  await flushVue();
  assert.equal(controls(socket).filter(({ type }) => type === "speak.start").length, 1, "sending alone cannot replay previous answers");
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
    { id: "user-b", role: "user", text: "Please answer again" },
    { id: "answer-b", role: "assistant", text: "New invited answer." }];
  await flushVue();
  assert.deepEqual(controls(socket).filter(({ type }) => type === "speak.start").map(({ text }) => text), ["First reply.", "New invited answer."]);
});

test("Stop during submission survives admission, retry and reopening the microphone", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const delivered = [];
  view.colleagueProps.submit = async (text, options) => delivered.push({ text, ...options });
  await view.colleague.toggleReadAloud();
  view.colleague.inviteSpeech("pending-user");
  view.colleague.stopSpeech();
  const starting = view.colleague.talk();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  view.colleague.inviteSpeech("pending-user");
  view.colleagueProps.conversation.messages = [
    { id: "pending-user", role: "user", text: "The delayed request" },
    { id: "pending-answer", role: "assistant", text: "Its delayed answer." }
  ];
  await flushVue();
  assert.equal(view.voice.listening.value, true);
  assert.equal(controls(socket).some(({ type }) => type === "speak.start"), false);
  socket.receive({ type: "transcript.partial", turnId: view.voice.activeListenTurnId.value, text: "Now tell me" });
  await view.colleague.talk();
  socket.receive({ type: "transcript.final", turnId: view.voice.activeListenTurnId.value, text: "Now tell me" });
  await flushVue();
  assert.equal(controls(socket).some(({ type }) => type === "speak.start"), false, "transcript delivery does not revive an old answer");
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
    { id: delivered[0].messageId, role: "user", text: delivered[0].text },
    { id: "fresh-answer", role: "assistant", text: "A newly invited answer." }];
  await flushVue();
  assert.deepEqual(controls(socket).filter(({ type }) => type === "speak.start").map(({ text }) => text), ["A newly invited answer."]);
});

test("late playback preparation cannot undo a newer Stop speaking", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.voice.preparePlayback();
  const resume = Promise.withResolvers();
  t.after(() => resume.resolve());
  view.contexts[0].state = "suspended";
  view.contexts[0].nextResume = resume.promise;
  const enabling = view.colleague.toggleReadAloud();
  view.colleague.stopSpeech();
  resume.resolve();
  await enabling;
  view.colleagueProps.conversation.messages = [{ id: "late-answer", role: "assistant", text: "Stay quiet." }];
  await flushVue();
  assert.equal(view.sockets.length, 0);
});

test("Colleague delivers a final transcript once with its recording target and retains retry identity", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const deliveries = [];
  view.colleagueProps.submit = async (text, options) => {
    deliveries.push({ text, ...options });
    if (deliveries.length === 1) throw new Error("Delivery could not be confirmed.");
  };
  const talking = view.colleague.talk();
  await flushVue();
  view.media[0].resolve();
  await talking;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  view.colleagueProps.focus = { projectSlug: "other", sessionId: "other-session" };
  socket.receive({ type: "transcript.partial", turnId, text: "Partial" });
  await flushVue();
  assert.equal(deliveries.length, 0);
  await view.colleague.talk();
  socket.receive({ type: "transcript.final", turnId, text: "Steer this session." });
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].focus, { projectSlug: "example", sessionId: "session-a" });
  assert.equal(view.colleague.pendingTranscript.value.text, "Steer this session.");
  assert.equal(view.notices.length, 1);
  assert.equal(view.notices[0].intent, "action-feedback");
  await view.colleague.deliverTranscript();
  assert.deepEqual(deliveries[1], deliveries[0]);
  assert.equal(view.colleague.pendingTranscript.value, null);
  socket.receive({ type: "transcript.final", turnId, text: "Steer this session." });
  await flushVue();
  assert.equal(deliveries.length, 2);
});

test("Colleague clears an admitted voice retry on readback and dismisses an unsent utterance without resending", async (t) => {
  const view = mountVoice(t, { colleague: true });
  let submissions = 0;
  view.colleagueProps.submit = async () => { submissions += 1; throw new Error("Network request failed."); };
  const pending = { text: "Open my project", messageId: "voice-retry", focus: { projectSlug: "example" } };
  view.colleague.pendingTranscript.value = pending;
  await view.colleague.deliverTranscript();
  await flushVue();
  assert.equal(view.colleague.error.value, "Network request failed.");
  assert.equal(view.notices.length, 1);
  view.colleagueProps.conversation.messages = [{ id: "another", role: "user", text: pending.text }];
  await flushVue();
  assert.ok(view.colleague.pendingTranscript.value, "equal text is not an admission receipt");
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
    { id: pending.messageId, role: "user", text: pending.text }];
  await flushVue();
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.colleague.error.value, "");
  assert.equal(submissions, 1, "readback must not replay the utterance");
  view.colleague.pendingTranscript.value = { ...pending, messageId: "unsent" };
  await view.colleague.deliverTranscript();
  await flushVue();
  view.colleague.dismissTranscript();
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.colleague.error.value, "");
  assert.equal(submissions, 2, "Dismiss never submits");
});

test("discarding Colleague recording preserves speech and prevents late transcript delivery", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const talking = view.colleague.talk();
  await flushVue();
  view.media[0].resolve();
  await talking;
  await view.speak("Continuing to speak.", "reply");
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "speech.start", turnId: "reply" });
  socket.receive(new Int16Array([1, 2]).buffer);
  await view.colleague.cancelRecording();
  socket.receive({ type: "transcript.final", turnId, text: "Discarded." });
  await flushVue();
  assert.deepEqual(deliveries, []);
  assert.equal(view.voice.speaking.value, true);
  assert.deepEqual(controls(socket).filter(({ type }) => type === "cancel"), [{ type: "cancel", turnId }]);
});

test("session and Colleague microphone acquisition cannot overlap", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const sessionVoice = view.anotherVoice();
  const talking = view.colleague.talk();
  await flushVue();
  assert.equal(await sessionVoice.startListening(), false);
  assert.match(sessionVoice.error.value, /other conversation/);
  assert.equal(view.media.length, 1);
  view.media[0].resolve();
  await talking;
  await view.colleague.cancelRecording();
  const startingSession = sessionVoice.startListening();
  await flushVue();
  view.media[1].resolve();
  assert.equal(await startingSession, true);
  await sessionVoice.cancel();
});

test("session and Colleague speech wait for each other without replacing a playing answer", async (t) => {
  const view = mountVoice(t, { speechEnabled: true });
  const other = view.anotherVoice();
  await view.speak("Session answer.", "session-reply");
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "session-reply" });
  const waiting = other.speak("Colleague answer.", "colleague-reply");
  await flushVue();
  assert.deepEqual(controls(view.sockets[1]), []);
  assert.equal(view.voice.activeSpeechTurnId.value, "session-reply");
  socket.receive({ type: "speech.end", turnId: "session-reply" });
  assert.equal(await waiting, true);
  assert.equal(controls(view.sockets[1])[0].turnId, "colleague-reply");
  const cancelled = view.speak("Queued then cancelled.", "cancelled");
  await flushVue();
  view.voice.stopSpeaking();
  assert.deepEqual(await cancelled, { value: false });
  other.stopSpeaking();
  await flushVue();
  assert.equal(controls(socket).filter(({ type }) => type === "speak.start").length, 1);
});

test("voice overlapping Talk requests own only one pending microphone acquisition", async (t) => {
  const view = mountVoice(t);
  const first = view.start();
  await flushVue();
  assert.equal(view.media.length, 1);

  const second = view.start();
  await flushVue();
  assert.equal(view.media.length, 1, "another Talk press cannot acquire a second unowned stream");
  view.media[0].resolve();
  assert.deepEqual(await first, { value: true });
  await second;
  assert.equal(controls(view.sockets[0]).filter((message) => message.type === "listen.start").length, 1);
  await view.voice.cancel();
  assert.equal(view.media[0].stops, 1);
});

test("voice microphone startup does not wait for speaker playback to resume", async (t) => {
  const view = mountVoice(t);
  await view.voice.preparePlayback();
  const resume = Promise.withResolvers();
  view.contexts[0].nextResume = resume.promise;
  const starting = view.start();
  try {
    await flushVue();
    assert.equal(view.media.length, 1, "speaker startup must not block microphone permission");
    view.media[0].resolve();
    assert.deepEqual(await starting, { value: true });
  } finally {
    resume.resolve();
  }
});

test("voice preserves a service rejection during connection and allows the next Talk request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = mountVoice(t, { autoReady: false });
  const starting = view.start();
  await flushVue();
  view.sockets[0].receive({ type: "error", code: "voice_busy", message: "Voice is busy. Try again shortly." });
  await flushVue();
  t.mock.timers.tick(8_000);
  assert.deepEqual(await starting, { value: false });
  assert.equal(view.voice.error.value, "Voice is busy. Try again shortly.");
  assert.equal(view.media.length, 0);
  const retry = view.start();
  await flushVue();
  view.sockets[1].ready();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await retry, { value: true });
  assert.equal(view.voice.error.value, "");
});

test("voice cancel disposes a microphone granted after the pending Talk request was cancelled", async (t) => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  assert.equal(view.media.length, 1);

  await view.voice.cancel();
  assert.equal(view.voice.state.value, "idle");
  view.media[0].resolve();
  const result = await starting;

  assert.deepEqual(controls(view.sockets[0]), [], "cancelled acquisition must not announce a late listen.start");
  assert.deepEqual(result, { value: false });
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.contexts.find((context) => context.stream === view.media[0].stream).state, "closed");
  assert.equal(view.voice.state.value, "idle");
  assert.equal(view.voice.error.value, "");
});

test("voice changing sessions keeps the new microphone owner when an old permission request resolves", async (t) => {
  const view = mountVoice(t);
  const oldStart = view.start();
  await flushVue();
  assert.equal(view.media.length, 1);

  view.sessionId.value = "session-b";
  await flushVue();
  const currentStart = view.start();
  await flushVue();
  assert.equal(view.media.length, 2);
  assert.match(view.sockets[0].url, /\/voice\/session-a$/u);
  assert.match(view.sockets[1].url, /\/voice\/session-b$/u);
  assert.equal(view.sockets[0].readyState, 3);
  view.media[1].resolve();
  assert.deepEqual(await currentStart, { value: true });
  const currentTurn = controls(view.sockets[1])[0].turnId;
  view.worklets[0].emit(new Float32Array([0.05]));
  const currentLevel = view.voice.inputLevel.value;
  assert.ok(currentLevel > 0);

  view.media[0].resolve();
  const oldResult = await oldStart;
  assert.deepEqual(controls(view.sockets[1]), [{ type: "listen.start", turnId: currentTurn, sampleRate: 16_000 }],
    "the old session must not start another recording on the new session's socket");
  assert.deepEqual(oldResult, { value: false });
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.media[1].stops, 0);
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.voice.inputLevel.value, currentLevel, "old capture cleanup must not reset B's input meter");
  await view.voice.cancel();
  assert.equal(view.media[1].stops, 1, "cancel must still own B's live capture");
});

test("voice unmount silently disposes a microphone granted after component teardown", async (t) => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  assert.equal(view.media.length, 1);

  view.unmount();
  view.media[0].resolve();
  const result = await starting;
  assert.deepEqual(result, { value: false }, "teardown cancels pending Talk instead of reporting a late connection failure");
  assert.equal(view.media[0].stops, 1);
  assert.deepEqual(controls(view.sockets[0]), []);
  assert.ok(view.contexts.every((context) => context.state === "closed"));
  assert.equal(view.voice.error.value, "");
});

test("voice normal Stop flushes native 16 kHz final PCM before listen.stop and releases capture", async (t) => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await starting, { value: true });
  assert.equal(view.media[0].constraints.audio.sampleRate.ideal, 16_000);
  const capture = view.worklets[0];
  const socket = view.sockets[0];
  const turnId = controls(socket)[0].turnId;
  capture.emit(new Float32Array([0.5]));
  assert.ok(view.voice.inputLevel.value > 0);

  capture.holdFlush = true;
  const stopping = view.voice.stopListening();
  assert.equal(capture.flushRequested, true);
  assert.equal(view.media[0].stops, 0);
  assert.deepEqual(controls(socket).map((message) => message.type), ["listen.start"]);
  capture.finishFlush(new Float32Array([-1, 1]));
  await stopping;

  assert.deepEqual(socket.sent.map((item) => typeof item === "string" ? JSON.parse(item).type : "pcm"),
    ["listen.start", "pcm", "pcm", "listen.stop"]);
  assert.deepEqual([...new Int16Array(socket.sent[2])], [-32_768, 32_767]);
  assert.deepEqual(controls(socket)[1], { turnId, type: "listen.stop" });
  assert.equal(view.media[0].stops, 1);
  assert.equal(capture.context.state, "closed");
  assert.equal(view.voice.inputLevel.value, 0);
  assert.equal(view.voice.state.value, "transcribing");

  socket.receive({ type: "transcript.final", turnId, text: "Current session message" });
  assert.equal(view.voice.transcript.value, "Current session message");
  assert.equal(view.voice.state.value, "idle");
});

test("voice repeated Stop sends one control after the owned capture's final PCM flush", async (t) => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await starting, { value: true });
  const capture = view.worklets[0];
  const socket = view.sockets[0];
  const turnId = controls(socket)[0].turnId;

  capture.holdFlush = true;
  const firstStop = view.voice.stopListening();
  const secondStop = view.voice.stopListening();
  await flushVue();
  assert.equal(capture.flushRequested, true);
  assert.deepEqual(controls(socket).map((message) => message.type), ["listen.start"],
    "a repeated Stop cannot send control before the first Stop flushes its capture");
  assert.equal(view.media[0].stops, 0);
  assert.notEqual(capture.context.state, "closed");

  capture.finishFlush(new Float32Array([-1, 1]));
  await Promise.all([firstStop, secondStop]);
  assert.deepEqual(socket.sent.map((item) => typeof item === "string" ? JSON.parse(item).type : "pcm"),
    ["listen.start", "pcm", "listen.stop"]);
  assert.deepEqual([...new Int16Array(socket.sent[1])], [-32_768, 32_767]);
  assert.deepEqual(controls(socket)[1], { turnId, type: "listen.stop" });
  assert.equal(view.media[0].stops, 1);
  assert.equal(capture.context.state, "closed");
  assert.equal(view.voice.state.value, "transcribing");

  await view.voice.stopListening();
  assert.deepEqual(controls(socket).map((message) => message.type), ["listen.start", "listen.stop"],
    "awaiting the transcript must not permit another Stop for the same capture");
  assert.equal(view.media[0].stops, 1);
});

test("voice current microphone denial remains visible and a later Talk request can recover", async (t) => {
  const view = mountVoice(t);
  const denied = view.start();
  await flushVue();
  view.media[0].reject(Object.assign(new Error("Controlled permission denial"), { name: "NotAllowedError" }));
  assert.deepEqual(await denied, { value: false });
  assert.match(view.voice.error.value, /Microphone access was denied/u);
  assert.equal(view.voice.state.value, "error");

  const retry = view.start();
  await flushVue();
  assert.equal(view.media.length, 2);
  view.media[1].resolve();
  assert.deepEqual(await retry, { value: true });
  assert.equal(view.voice.error.value, "");
  assert.equal(view.voice.listening.value, true);
  await view.voice.cancel();
  assert.equal(view.media[1].stops, 1);
});

for (const failure of ["active socket loss", "terminal server error"]) {
  test(`voice Talk retries after ${failure} by disposing the old capture and acquiring a new one`, async (t) => {
    const view = mountVoice(t);
    const first = view.start();
    await flushVue();
    view.media[0].resolve();
    assert.deepEqual(await first, { value: true });
    const oldSocket = view.sockets[0];
    const oldCapture = view.worklets[0];
    const oldTurn = controls(oldSocket)[0].turnId;

    if (failure === "active socket loss") oldSocket.close();
    else oldSocket.receive({ type: "error", message: "Voice recordings are limited to 60 seconds." });
    await flushVue();
    assert.equal(view.voice.state.value, "error");
    assert.match(view.voice.error.value, failure === "active socket loss"
      ? /Voice connection was interrupted/u
      : /Voice recordings are limited to 60 seconds/u);

    const retry = view.start();
    await flushVue();
    assert.equal(view.media.length, 2, "the failed active turn must not permanently block another Talk request");
    assert.equal(view.media[0].stops, 1, "retry must release the failed turn's microphone");
    assert.equal(oldCapture.context.state, "closed");
    view.media[1].resolve();
    assert.deepEqual(await retry, { value: true });
    const currentSocket = view.sockets.at(-1);
    const currentTurn = controls(currentSocket).filter((message) => message.type === "listen.start").at(-1).turnId;
    assert.notEqual(currentTurn, oldTurn);
    assert.equal(view.voice.error.value, "");
    assert.equal(view.voice.listening.value, true);
    assert.equal(view.media[1].stops, 0);
    await view.voice.cancel();
    assert.equal(view.media[1].stops, 1);
  });
}

test("voice stale socket errors and late failed-capture cleanup cannot retire a newer session", async (t) => {
  const view = mountVoice(t);
  const first = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await first, { value: true });
  const oldSocket = view.sockets[0];
  const oldCapture = view.worklets[0];
  oldCapture.holdFlush = true;
  oldSocket.receive({ type: "error", message: "Current recording failed." });
  assert.equal(view.voice.state.value, "error");
  assert.equal(oldCapture.flushRequested, true);

  view.sessionId.value = "session-b";
  const next = view.start();
  await flushVue();
  view.media[1].resolve();
  assert.deepEqual(await next, { value: true });
  view.worklets[1].emit(new Float32Array([0.05]));
  const currentLevel = view.voice.inputLevel.value;
  const currentControls = controls(view.sockets[1]);

  oldSocket.receive({ type: "error", message: "Stale previous connection failure." });
  oldCapture.finishFlush(new Float32Array([-1, 1]));
  await flushVue();
  assert.equal(view.voice.state.value, "listening");
  assert.equal(view.voice.error.value, "");
  assert.equal(view.voice.inputLevel.value, currentLevel);
  assert.deepEqual(controls(view.sockets[1]), currentControls);
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.media[1].stops, 0);
});

test("voice socket loss during permission acquisition retires pending Talk and allows retry", async (t) => {
  const view = mountVoice(t);
  const first = view.start();
  await flushVue();
  assert.equal(view.media.length, 1);
  view.sockets[0].close();
  await flushVue();
  assert.equal(view.voice.state.value, "error");
  assert.match(view.voice.error.value, /Voice connection was interrupted/u);

  const retry = view.start();
  await flushVue();
  assert.equal(view.media.length, 2);
  view.media[1].resolve();
  assert.deepEqual(await retry, { value: true });
  view.media[0].resolve();
  assert.deepEqual(await first, { value: false });
  assert.equal(view.voice.state.value, "listening");
  assert.equal(view.voice.error.value, "");
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.media[1].stops, 0);
});

test("voice stale playback rejection cannot release a newer session's microphone", async (t) => {
  const resume = Promise.withResolvers();
  resume.promise.catch(() => null);
  t.after(() => resume.reject(new Error("Controlled resume cleanup")));
  const view = mountVoice(t, { speechEnabled: true });
  assert.equal(await view.voice.speak("Previous session answer", "speech-a"), true);
  view.sockets[0].receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
  view.contexts[0].nextResume = resume.promise;
  view.sockets[0].receive({ type: "speech.segment", turnId: "speech-a", sampleCount: 1 });
  view.sockets[0].receive(new ArrayBuffer(2));
  await flushVue();
  assert.equal(view.contexts[0].nextResume, null, "the real playback queue is awaiting this resume");

  view.sessionId.value = "session-b";
  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await starting, { value: true });
  const currentSocket = view.sockets[1];
  const currentTurn = controls(currentSocket)[0].turnId;
  view.worklets[0].emit(new Float32Array([0.05]));
  const currentLevel = view.voice.inputLevel.value;

  resume.reject(new Error("Stale previous-session playback failure"));
  await flushVue();
  assert.equal(view.voice.error.value, "");
  assert.equal(view.media[0].stops, 0);
  assert.equal(view.voice.inputLevel.value, currentLevel);
  assert.equal(view.voice.state.value, "listening", "the stale queue finalizer must not set B idle");
  await view.voice.stopListening();
  assert.deepEqual(controls(currentSocket).at(-1), { turnId: currentTurn, type: "listen.stop" });
  assert.equal(view.media[0].stops, 1, "B's own Stop still owns and releases its capture");
});

test("voice current playback rejection remains a visible current error", async (t) => {
  const resume = Promise.withResolvers();
  resume.promise.catch(() => null);
  t.after(() => resume.reject(new Error("Controlled resume cleanup")));
  const view = mountVoice(t, { speechEnabled: true });
  assert.equal(await view.voice.speak("Current answer", "speech-current"), true);
  view.sockets[0].receive({ type: "speech.start", turnId: "speech-current", sampleRate: 22_050 });
  view.contexts[0].nextResume = resume.promise;
  view.sockets[0].receive({ type: "speech.segment", turnId: "speech-current", sampleCount: 1 });
  view.sockets[0].receive(new ArrayBuffer(2));
  await flushVue();
  assert.equal(view.contexts[0].nextResume, null);

  resume.reject(new Error("Current playback failed to resume"));
  await flushVue();
  assert.equal(view.voice.state.value, "error");
  assert.equal(view.voice.error.value, "Current playback failed to resume");
});

for (const type of ["busy", "error"]) {
  test(`voice stale tagged speech ${type} on the same socket cannot release a newer recording`, async (t) => {
    const view = mountVoice(t, { speechEnabled: true });
    assert.equal(await view.voice.speak("Previous speech", "speech-a"), true);
    const socket = view.sockets[0];
    const starting = view.start();
    await flushVue();
    view.media[0].resolve();
    assert.deepEqual(await starting, { value: true });
    assert.equal(view.sockets.length, 1, "Talk reuses the same ready connection");
    const currentTurn = controls(socket).find((message) => message.type === "listen.start").turnId;
    view.worklets[0].emit(new Float32Array([0.05]));
    const currentLevel = view.voice.inputLevel.value;

    socket.receive({ type, turnId: "speech-a", message: "Delayed previous speech failure." });
    await flushVue();
    assert.equal(view.media[0].stops, 0, "a stale speech failure must not release B's live microphone");
    assert.equal(view.voice.error.value, "");
    assert.equal(view.voice.state.value, "listening");
    assert.equal(view.voice.inputLevel.value, currentLevel);
    await view.voice.stopListening();
    assert.deepEqual(controls(socket).at(-1), { turnId: currentTurn, type: "listen.stop" });
    assert.equal(view.media[0].stops, 1);
  });
}

test("voice current tagged speech error remains visible", async (t) => {
  const view = mountVoice(t, { speechEnabled: true });
  assert.equal(await view.voice.speak("Current speech", "speech-current"), true);
  view.sockets[0].receive({ type: "error", turnId: "speech-current", message: "Current synthesis failed." });
  await flushVue();

  assert.equal(view.voice.error.value, "Current synthesis failed.");
  assert.equal(view.voice.state.value, "error");
});

test("voice permission denial after cancellation stays silent", async (t) => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  await view.voice.cancel();
  view.media[0].reject(Object.assign(new Error("Late controlled denial"), { name: "NotAllowedError" }));

  assert.deepEqual(await starting, { value: false });
  assert.equal(view.voice.error.value, "");
  assert.equal(view.voice.state.value, "idle");
  assert.deepEqual(controls(view.sockets[0]), []);
});

test("voice changing sessions during Stop flush cannot finish or reset the new recording", async (t) => {
  const view = mountVoice(t);
  const first = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await first, { value: true });
  const oldCapture = view.worklets[0];
  oldCapture.holdFlush = true;
  const stopping = view.voice.stopListening().then((value) => ({ value }), (error) => ({ error }));
  assert.equal(oldCapture.flushRequested, true);

  view.sessionId.value = "session-b";
  await flushVue();
  const next = view.start();
  await flushVue();
  view.media[1].resolve();
  assert.deepEqual(await next, { value: true });
  const currentControls = controls(view.sockets[1]);
  view.worklets[1].emit(new Float32Array([0.05]));
  const currentLevel = view.voice.inputLevel.value;

  oldCapture.finishFlush(new Float32Array([-1, 1]));
  assert.deepEqual(await stopping, { value: undefined });
  assert.deepEqual(controls(view.sockets[1]), currentControls);
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.voice.inputLevel.value, currentLevel);
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.media[1].stops, 0);
});

test("voice cancelling a pending connection leaves a later session ready to record", async (t) => {
  const view = mountVoice(t, { autoReady: false });
  const first = view.start();
  await flushVue();
  assert.equal(view.sockets.length, 1);
  assert.equal(view.media.length, 0);

  await view.voice.cancel();
  assert.deepEqual(await first, { value: false });
  assert.equal(view.voice.error.value, "");
  view.sessionId.value = "session-b";
  const next = view.start();
  await flushVue();
  view.sockets[1].ready();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await next, { value: true });
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.voice.ready.value, true);
  assert.equal(view.voice.error.value, "");
});

for (const recording of [false, true]) {
  test(`voice obsolete speech.start cannot revive cancelled playback${recording ? " over a recording" : ""}`, async (t) => {
    const view = mountVoice(t, { speechEnabled: true });
    assert.equal(await view.voice.speak("Cancelled speech", "speech-a"), true);
    await view.voice.cancel();
    if (recording) {
      const starting = view.start();
      await flushVue();
      view.media[0].resolve();
      assert.deepEqual(await starting, { value: true });
    }

    view.sockets[0].receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
    view.sockets[0].receive({ type: "speech.segment", turnId: "speech-a", sampleCount: 1 });
    view.sockets[0].receive(new Int16Array([100]).buffer);
    await flushVue();
    assert.equal(view.voice.activeSpeechTurnId.value, "");
    assert.equal(view.voice.state.value, recording ? "listening" : "idle");
    assert.equal(view.buffers.length, 0);
    if (recording) assert.equal(view.media[0].stops, 0);
  });
}

test("voice ignores obsolete stream frames while B awaits its start and then completes B normally", async (t) => {
  const view = mountVoice(t, { speechEnabled: true });
  assert.equal(await view.voice.speak("Previous answer", "speech-a"), true);
  assert.equal(await view.voice.speak("Current answer", "speech-b"), true);
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
  socket.receive({ type: "speech.segment", turnId: "speech-a", sampleCount: 1 });
  socket.receive(new Int16Array([100]).buffer);
  socket.receive({ type: "speech.end", turnId: "speech-a" });
  await flushVue();
  assert.equal(view.voice.activeSpeechTurnId.value, "speech-b");
  assert.equal(view.voice.state.value, "thinking");
  assert.equal(view.buffers.length, 0);

  socket.receive({ type: "speech.start", turnId: "speech-b", sampleRate: 22_050 });
  socket.receive({ type: "speech.segment", turnId: "speech-b", sampleCount: 2 });
  socket.receive(new Int16Array([200, 300]).buffer);
  socket.receive({ type: "speech.end", turnId: "speech-b" });
  await flushVue();
  assert.deepEqual(view.buffers.map((buffer) => [...buffer.samples]), [[200 / 32_768, 300 / 32_768]]);
  assert.equal(view.voice.state.value, "speaking", "speech.end does not discard scheduled audio");
  view.sources[0].finish();
  assert.equal(view.voice.state.value, "idle");
  assert.equal(view.voice.activeSpeechTurnId.value, "");
});

for (const settleOldFirst of [true, false]) {
  test(`voice B drains its own queue with old A ${settleOldFirst ? "settling during B" : "still pending"}`, async (t) => {
    const oldResume = Promise.withResolvers();
    const currentResume = Promise.withResolvers();
    t.after(() => { oldResume.resolve(); currentResume.resolve(); });
    const receipts = [];
    const view = mountVoice(t, { speechEnabled: true, voiceOptions: { onPlayback: event => receipts.push(event) } });
    assert.equal(await view.voice.speak("Previous answer", "speech-a"), true);
    const socket = view.sockets[0];
    socket.receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
    view.contexts[0].nextResume = oldResume.promise;
    socket.receive({ type: "speech.segment", turnId: "speech-a", segmentIndex: 0, sampleCount: 1 });
    socket.receive(new Int16Array([100]).buffer);
    socket.receive({ type: "speech.segment", turnId: "speech-a", segmentIndex: 1, sampleCount: 1 });
    socket.receive(new Int16Array([101]).buffer);
    await flushVue();
    assert.equal(view.contexts[0].nextResume, null);

    assert.equal(await view.voice.speak("Current answer", "speech-b"), true);
    socket.receive({ type: "speech.start", turnId: "speech-b", sampleRate: 22_050 });
    socket.receive({ type: "speech.segment", turnId: "speech-b", segmentIndex: 0, sampleCount: 1 });
    socket.receive(new Int16Array([200]).buffer);
    await flushVue();
    assert.equal(view.buffers.length, 1, "B must schedule without waiting for A's obsolete resume");
    view.contexts[0].nextResume = currentResume.promise;
    socket.receive({ type: "speech.segment", turnId: "speech-b", segmentIndex: 1, sampleCount: 1 });
    socket.receive(new Int16Array([201]).buffer);
    socket.receive({ type: "speech.end", turnId: "speech-b" });
    await flushVue();
    assert.equal(view.contexts[0].nextResume, null);
    view.sources[0].finish();

    if (settleOldFirst) {
      oldResume.resolve();
      await flushVue();
    }
    assert.equal(view.voice.activeSpeechTurnId.value, "speech-b");
    assert.equal(view.voice.state.value, "thinking", "B waits for its second frame without claiming it is audible");
    assert.equal(view.buffers.length, 1);

    currentResume.resolve();
    await flushVue();
    assert.deepEqual(view.buffers.map((buffer) => [...buffer.samples]), [[200 / 32_768], [201 / 32_768]]);
    assert.ok(view.sources[1].startedAt > view.sources[0].startedAt);
    view.sources[1].finish();
    assert.equal(view.voice.activeSpeechTurnId.value, "");
    assert.equal(view.voice.state.value, "idle", "B completes after its own final source, independently of A");

    oldResume.resolve();
    await flushVue();
    assert.equal(view.buffers.length, 2);
    assert.equal(view.voice.state.value, "idle");
    assert.deepEqual(receipts, [
      { turnId: "speech-a", phase: "interrupted", reason: "cancelled" },
      { turnId: "speech-b", phase: "started" },
      { turnId: "speech-b", phase: "completed" }
    ], "obsolete queue settlement cannot emit for either output again");
  });
}

test("voice a stopped source's delayed ended event cannot set a newer recording idle", async (t) => {
  const view = mountVoice(t, { speechEnabled: true });
  assert.equal(await view.voice.speak("Previous answer", "speech-a"), true);
  view.sockets[0].receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
  view.sockets[0].receive({ type: "speech.segment", turnId: "speech-a", sampleCount: 1 });
  view.sockets[0].receive(new Int16Array([100]).buffer);
  await flushVue();
  const oldSource = view.sources[0];

  const starting = view.start();
  await flushVue();
  view.media[0].resolve();
  assert.deepEqual(await starting, { value: true });
  assert.equal(oldSource.stopped, true);
  oldSource.finish();
  assert.equal(oldSource.disconnected, true);
  assert.equal(view.voice.state.value, "listening");
  assert.equal(view.media[0].stops, 0);
});

for (const ending of ["cancel", "unmount"]) {
  test(`voice queued PCM does not prepare or allocate audio after ${ending}`, async (t) => {
    const resume = Promise.withResolvers();
    t.after(() => resume.resolve());
    const view = mountVoice(t, { speechEnabled: true });
    assert.equal(await view.voice.speak("Previous answer", "speech-a"), true);
    view.sockets[0].receive({ type: "speech.start", turnId: "speech-a", sampleRate: 22_050 });
    const context = view.contexts[0];
    context.nextResume = resume.promise;
    view.sockets[0].receive({ type: "speech.segment", turnId: "speech-a", segmentIndex: 0, sampleCount: 1 });
    view.sockets[0].receive(new Int16Array([100]).buffer);
    view.sockets[0].receive({ type: "speech.segment", turnId: "speech-a", segmentIndex: 1, sampleCount: 1 });
    view.sockets[0].receive(new Int16Array([101]).buffer);
    await flushVue();
    const resumeCalls = context.resumeCalls;
    if (ending === "unmount") view.unmount();
    else await view.voice.cancel();

    resume.resolve();
    await flushVue();
    assert.equal(view.contexts.length, 1, "obsolete queued work cannot create a replacement AudioContext");
    assert.equal(context.resumeCalls, resumeCalls, "the next obsolete frame must stop before preparePlayback");
    assert.equal(view.buffers.length, 0);
    assert.equal(view.sources.length, 0);
    if (ending === "unmount") assert.equal(context.state, "closed");
  });
}

for (const ending of ["cancel", "session change", "unmount", "mute then unmute"]) {
  test(`voice pending speech preparation cannot resume after ${ending}`, async (t) => {
    const resume = Promise.withResolvers();
    t.after(() => resume.resolve());
    const enabled = vue.ref(true);
    const view = mountVoice(t, { speechEnabled: enabled });
    await view.voice.preparePlayback();
    view.contexts[0].nextResume = resume.promise;
    const pending = view.speak("Obsolete answer", "speech-a");
    await flushVue();
    assert.equal(view.contexts[0].nextResume, null);
    if (ending === "cancel") await view.voice.cancel();
    else if (ending === "session change") view.sessionId.value = "session-b";
    else if (ending === "unmount") view.unmount();
    else { enabled.value = false; enabled.value = true; }

    resume.resolve();
    assert.deepEqual(await pending, { value: false });
    assert.equal(view.sockets.length, 0, "obsolete startup cannot open a connection or send speech");
    assert.equal(view.voice.error.value, "");
    if (ending !== "unmount") {
      assert.equal(await view.voice.speak("Current answer", "speech-b"), true);
      view.sockets[0].receive({ type: "speech.start", turnId: "speech-b", sampleRate: 22_050 });
      view.sockets[0].receive({ type: "speech.end", turnId: "speech-b" });
      assert.equal(view.voice.activeSpeechTurnId.value, "");
      assert.equal(view.voice.state.value, "idle", "a valid zero-audio replacement stream still completes");
    }
  });
}

test("voice pending speech connection cannot publish into a later session", async (t) => {
  const view = mountVoice(t, { autoReady: false, speechEnabled: true });
  const previous = view.speak("Previous answer", "speech-a");
  await flushVue();
  assert.equal(view.sockets.length, 1);
  view.sessionId.value = "session-b";
  const current = view.speak("Current answer", "speech-b");
  await flushVue();
  view.sockets[1].ready();
  assert.deepEqual(await current, { value: true });
  assert.deepEqual(await previous, { value: false });
  assert.deepEqual(controls(view.sockets[0]), []);
  assert.deepEqual(controls(view.sockets[1]).filter((message) => message.type === "speak.start").map((message) => message.turnId), ["speech-b"]);
  view.sockets[1].receive({ type: "speech.start", turnId: "speech-b", sampleRate: 22_050 });
  view.sockets[1].receive({ type: "speech.end", turnId: "speech-b" });
  assert.equal(view.voice.activeSpeechTurnId.value, "");
  assert.equal(view.voice.state.value, "idle");
});

for (const ending of ["cancel", "disabled speech output"]) {
  test(`voice pending speech connection remains retired after ${ending} and a late socket error`, async (t) => {
    const enabled = vue.ref(true);
    const view = mountVoice(t, { autoReady: false, speechEnabled: enabled });
    const previous = view.speak("Previous answer", "speech-a");
    await flushVue();
    assert.equal(view.sockets.length, 1);
    const oldSocket = view.sockets[0];
    assert.equal(oldSocket.readyState, 0);
    assert.equal(view.voice.ready.value, false);
    if (ending === "cancel") await view.voice.cancel();
    else enabled.value = false;
    oldSocket.dispatchEvent(new Event("error"));
    assert.deepEqual(await previous, { value: false });
    assert.equal(view.voice.state.value, "idle", "the cancelled connection must not restore an error state");
    assert.equal(view.voice.error.value, "");

    enabled.value = true;
    const current = view.speak("Current answer", "speech-b");
    await flushVue();
    assert.equal(view.sockets.length, 2, "B must not reuse A's retired connection promise");
    view.sockets[1].ready();
    assert.deepEqual(await current, { value: true });
    oldSocket.receive({ type: "voice.ready" });
    oldSocket.dispatchEvent(new Event("error"));
    await flushVue();
    assert.equal(view.voice.activeSpeechTurnId.value, "speech-b");
    assert.equal(view.voice.state.value, "thinking");
    assert.equal(view.voice.ready.value, true);
    assert.equal(view.voice.error.value, "");
    assert.equal(view.sockets[1].readyState, 1);
    assert.deepEqual(controls(oldSocket), []);
    assert.deepEqual(controls(view.sockets[1]).map((message) => message.turnId), ["speech-b"]);
    view.sockets[1].receive({ type: "speech.start", turnId: "speech-b", sampleRate: 22_050 });
    view.sockets[1].receive({ type: "speech.end", turnId: "speech-b" });
    assert.equal(view.voice.state.value, "idle");
    assert.equal(view.voice.activeSpeechTurnId.value, "");
  });
}

test("starting push-to-talk loads voices before recording and keeps the selected speaker for each reply", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  await view.colleague.toggleReadAloud();
  await view.colleague.toggleLive();
  assert.equal(view.sockets.length, 1, "Start voice confirms the service even while the microphone stays off");
  assert.equal(view.media.length, 0);
  const socket = view.sockets[0];
  socket.receive({ type: "voice.ready", voices: [{ id: "emma", label: "Emma" }, { id: "michael", label: "Michael" }], defaultVoice: "emma" });
  assert.equal(view.voice.selectedVoice.value, "emma");
  view.voice.selectedVoice.value = "michael";
  await view.voice.speak("This uses Michael.", "male-reply");
  const start = controls(socket).find(message => message.type === "speak.start");
  assert.equal(start.voiceId, "michael");
  view.voice.selectedVoice.value = "emma";
  assert.equal(start.voiceId, "michael", "the next selection cannot rewrite an active request");
});

test("saved voice updates reach the live conversation and unavailable choices never overwrite preferences", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  await view.colleague.toggleReadAloud();
  view.colleagueProps.defaults.voiceId = "kitten_bella";
  await vue.nextTick();
  assert.equal(view.voice.selectedVoice.value, "kitten_bella");
  await view.colleague.toggleLive();
  const socket = view.sockets[0];
  const voices = [{ id: "kitten_bella", label: "Bella" }, { id: "kitten_jasper", label: "Jasper" }];
  socket.receive({ type: "voice.ready", voices, defaultVoice: "kitten_bella" });
  await vue.nextTick();
  view.colleagueProps.defaults.voiceId = "kitten_jasper";
  await vue.nextTick();
  await view.voice.speak("Saved choice.", "saved-voice");
  assert.equal(controls(socket).find(message => message.type === "speak.start").voiceId, "kitten_jasper");
  socket.receive({ type: "voice.ready", voices: voices.slice(0, 1), defaultVoice: "kitten_bella" });
  await vue.nextTick();
  assert.equal(view.voice.selectedVoice.value, "");
  assert.equal(view.colleagueProps.defaults.voiceId, "kitten_jasper");
  socket.receive({ type: "voice.ready", voices, defaultVoice: "kitten_bella" });
  await vue.nextTick();
  assert.equal(view.voice.selectedVoice.value, "kitten_jasper", "reinstalled voices restore the saved choice");
  assert.equal(view.media.length, 0);
});

test("push-to-talk keeps one conversation open across turns and preserves sound off", async (t) => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  const call = view.colleague;
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  assert.equal(call.callMode.value, "push-to-talk");
  await call.toggleLive();
  assert.equal(call.callConnection.value, "Voice active");
  assert.equal(call.callStatus.value, "Hold to speak");
  assert.equal(view.media.length, 0, "the mic stays closed between push-to-talk turns");
  assert.equal(call.readAloud.value, false, "mic startup preserves the default sound-off preference");
  for (const text of ["Inspect this project.", "Now explain the change."]) {
    const press = call.startPushToTalk();
    await flushVue();
    assert.equal(call.callConnection.value, "Voice active", "opening a mic for the next turn does not restart the conversation");
    view.media.at(-1).resolve(); await press;
    assert.equal(call.callStatus.value, "Listening to you");
    assert.equal(call.readAloud.value, false, "holding the mic preserves the sound setting");
    const socket = view.sockets.at(-1);
    const turnId = view.voice.activeListenTurnId.value;
    socket.receive({ type: "transcript.partial", turnId, text, revision: 1 });
    await flushVue();
    assert.equal(deliveries.length, text.startsWith("Inspect") ? 0 : 1);
    await call.finishPushToTalk();
    assert.equal(view.media.at(-1).stops, 1);
    socket.receive({ type: "transcript.final", turnId, text });
    await flushVue();
    assert.equal(call.live.value, true);
    assert.equal(call.callStatus.value, "Hold to speak");
  }
  assert.deepEqual(deliveries.map(([text]) => text), ["Inspect this project.", "Now explain the change."]);
  assert.notEqual(deliveries[0][1].messageId, deliveries[1][1].messageId);
  view.colleagueProps.conversation.status = "working";
  await call.toggleLive();
  assert.equal(call.callConnection.value, "Voice off");
  assert.equal(call.readAloud.value, false);
  assert.equal(view.colleagueProps.conversation.status, "working", "End never cancels the model's work");
});

for (const text of ["Stop talking", "Please stop speaking.", "Stap talking", "Be quiet", "Do not stop talking", "Stop talking about DeepSeek and list my projects."]) {
  test(`push-to-talk handles ${JSON.stringify(text)} without confusing silence with a new request`, async (t) => {
    const silence = !text.startsWith("Do not") && !text.includes("DeepSeek");
    const view = mountVoice(t, { colleague: true, callMode: "push-to-talk" });
    await view.colleague.toggleReadAloud();
    const call = view.colleague;
    const deliveries = [];
    view.colleagueProps.submit = async (...args) => deliveries.push(args);
    await call.toggleLive();
    view.colleagueProps.conversation.status = "working";
    await view.speak("An answer in progress", "answer");
    const socket = view.sockets[0];
    socket.receive({ type: "speech.start", turnId: "answer" });
    socket.receive(new Int16Array([1, 2]).buffer);
    await flushVue();
    const press = call.startPushToTalk();
    await flushVue(); view.media[0].resolve(); await press;
    const turnId = view.voice.activeListenTurnId.value;
    socket.receive({ type: "transcript.partial", turnId, text, revision: 1 });
    await new Promise(resolve => setTimeout(resolve, 150));
    await flushVue();
    if (silence) assert.equal(view.sources[0].stopped, true, "the command stops playback while held");
    await call.finishPushToTalk();
    socket.receive({ type: "transcript.final", turnId, text });
    await flushVue();
    assert.deepEqual(deliveries.map(([message]) => message), silence ? [] : [text]);
    assert.equal(call.pendingTranscript.value, null);
    assert.equal(call.live.value, true);
    assert.equal(view.colleagueProps.conversation.status, "working");
    if (silence) {
      view.colleagueProps.conversation.streamingReply = { id: "late:progress", role: "assistant", status: "completed", text: "Let me check that." };
      await flushVue();
      assert.equal(controls(socket).filter(message => message.type === "speak.start").length, 1, "late progress cannot break silence");
      assert.equal(view.voice.captureState.value, "idle");
    }
  });
}

for (const action of ["release", "blur", "end"]) {
  test(`push-to-talk ${action} cancels pending permission without sending late words`, async (t) => {
    const view = mountVoice(t, { colleague: true, callMode: "push-to-talk" });
    const call = view.colleague;
    view.colleagueProps.submit = () => assert.fail("cancelled capture cannot send");
    await call.toggleLive();
    const press = call.startPushToTalk();
    await flushVue();
    if (action === "release") await call.finishPushToTalk();
    else if (action === "blur") { window.dispatchEvent(new Event("blur")); await flushVue(); }
    else await call.toggleLive();
    view.media[0].resolve(); await press;
    assert.equal(view.media[0].stops, 1);
    assert.equal(call.pushHolding.value, false);
    assert.equal(view.voice.captureState.value, "idle");
    assert.equal(call.live.value, action !== "end");
  });
}

test("switching conversation modes preserves history and refuses to discard unfinished words", async (t) => {
  const view = mountVoice(t, { colleague: true, callMode: "push-to-talk" });
  const call = view.colleague;
  view.colleagueProps.conversation.messages = [{ id: "earlier", role: "user", text: "Remember this." }];
  await call.toggleLive();
  const switching = call.changeCallMode("hands-free");
  await flushVue(); view.media[0].resolve(); await switching;
  assert.equal(view.voice.listening.value, true);
  assert.equal(call.callMode.value, "hands-free");
  assert.equal(controls(view.sockets[0]).find(message => message.type === "listen.start").continuous, true);
  await call.toggleMicrophoneMuted();
  assert.equal(call.callConnection.value, "Voice active");
  assert.equal(call.callStatus.value, "Microphone muted");
  assert.equal(call.callAudioLevel.value, 0);
  await call.toggleMicrophoneMuted();
  const turnId = view.voice.activeListenTurnId.value;
  view.sockets[0].receive({ type: "transcript.partial", turnId, text: "Please keep", revision: 1 });
  await flushVue();
  await call.changeCallMode("push-to-talk");
  assert.equal(call.callMode.value, "hands-free");
  view.voice.partialTranscript.value = "";
  await call.changeCallMode("push-to-talk");
  assert.equal(call.callMode.value, "push-to-talk");
  assert.equal(view.media[0].stops, 1);
  assert.equal(call.live.value, true);
  assert.equal(view.colleagueProps.conversation.messages[0].text, "Remember this.");
  assert.equal(view.colleagueProps.conversation.conversationId, "colleague");
});

test("voice captions follow recognized words, progress and the final answer from the same conversation", async (t) => {
  const view = mountVoice(t, { colleague: true, callMode: "push-to-talk" });
  const conversation = view.colleagueProps.conversation;
  conversation.messages = [{ id: "old-user", role: "user", text: "Earlier question." }, { id: "old-answer", role: "assistant", text: "Earlier answer." }];
  await flushVue();
  assert.equal(view.colleague.voiceWords.value, "Earlier question.");
  assert.equal(view.colleague.voiceAnswer.value, "Earlier answer.");
  view.colleagueProps.submit = async (text, options) => {
    conversation.messages = [...conversation.messages, { id: options.messageId, role: "user", text }];
  };
  await view.colleague.toggleLive();
  const press = view.colleague.startPushToTalk();
  await flushVue(); view.media[0].resolve(); await press;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "Check my", revision: 1 });
  await flushVue();
  assert.equal(view.colleague.voiceWords.value, "Check my");
  socket.receive({ type: "transcript.partial", turnId, text: "Check my projects", revision: 2 });
  await flushVue();
  assert.equal(view.colleague.voiceWords.value, "Check my projects");
  await view.colleague.finishPushToTalk();
  socket.receive({ type: "transcript.final", turnId, text: "Check my projects." });
  await flushVue();
  assert.equal(view.colleague.voiceWords.value, "Check my projects.");
  conversation.streamingReply = { id: "progress", role: "assistant", text: "Let me check your projects." };
  await flushVue();
  assert.equal(view.colleague.voiceAnswer.value, "Let me check your projects.");
  conversation.streamingReply = { id: "answer", role: "assistant", text: "You have" };
  await flushVue();
  assert.equal(view.colleague.voiceAnswer.value, "You have");
  conversation.messages = [...conversation.messages, { id: "answer", role: "assistant", text: "You have two projects." }];
  conversation.streamingReply = null;
  await flushVue();
  assert.equal(view.colleague.voiceAnswer.value, "You have two projects.");
  assert.equal(view.colleague.voiceWords.value, "Check my projects.");
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 0, "captions do not require sound");
});

test("hands-free startup opens capture without Helper routing or speaker startup", async (t) => {
  const view = mountVoice(t, { colleague: true });
  view.colleagueProps.check = () => assert.fail("live voice must not check Helper routing");
  view.colleagueProps.classify = () => assert.fail("live voice must not classify with a Helper");
  const starting = view.colleague.toggleLive();
  await flushVue();
  assert.equal(view.contexts.length, 0, "sound-off microphone startup allocates no playback context");
  assert.equal(view.media.length, 1);
  view.media[0].resolve(); await starting;
  assert.equal(view.colleague.starting.value, false);
  assert.equal(view.colleague.live.value, true);
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.colleague.readAloud.value, false);
  assert.match(view.colleague.status.value, /Live conversation.*Listening/);
});

test("blocked speaker startup leaves requested sound on and capture usable", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.voice.preparePlayback();
  view.contexts[0].nextResume = Promise.reject(new Error("Playback is unavailable."));
  await view.colleague.toggleReadAloud();
  assert.equal(view.voice.playbackBlocked.value, true);
  assert.equal(view.colleague.readAloud.value, true);
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.colleague.live.value, true);
  assert.equal(view.colleague.error.value, "");
  assert.equal(view.colleague.readAloud.value, true);
  await view.colleague.enableSound();
  assert.equal(view.voice.playbackBlocked.value, false);
  assert.deepEqual(view.emitted.filter(([kind]) => kind === "readAloud"), [["readAloud", true]], "recovery is not another preference change");
});

for (const action of ["cancel", "mute", "pagehide", "unmount"]) {
  test(`late connection setup cannot open the microphone after ${action}`, async (t) => {
    const view = mountVoice(t, { colleague: true, autoReady: false });
    const starting = view.colleague.toggleLive();
    await flushVue();
    if (action === "cancel") await view.colleague.toggleLive();
    else if (action === "mute") await view.colleague.toggleMicrophoneMuted();
    else if (action === "pagehide") window.dispatchEvent(new Event("pagehide"));
    else view.unmount();
    view.sockets[0].ready();
    await starting;
    assert.equal(view.media.length, 0);
    assert.equal(view.colleague.live.value, false);
    assert.equal(view.colleague.readAloud.value, false);
    assert.equal(view.colleague.error.value, "");
  });
}

test("cancelling microphone startup preserves speech and a late speaker failure cannot affect a retry", async (t) => {
  const view = mountVoice(t, { colleague: true, autoReady: false });
  const enabling = view.colleague.toggleReadAloud(); await enabling;
  const speaking = view.speak("Keep speaking this answer", "answer");
  await flushVue(); view.sockets[0].ready(); await speaking;
  view.sockets[0].receive({ type: "speech.start", turnId: "answer" });
  view.sockets[0].receive(new Int16Array(22050).buffer);
  await flushVue();
  const playback = Promise.withResolvers();
  t.after(() => playback.resolve());
  const prepare = view.voice.preparePlayback;
  view.voice.preparePlayback = () => playback.promise;
  const first = view.colleague.toggleLive();
  await view.colleague.toggleLive();
  assert.equal(view.sources[0].stopped, false);
  view.voice.preparePlayback = prepare;
  const second = view.colleague.toggleLive();
  await flushVue(); view.media.at(-1).resolve(); await second;
  playback.reject(new Error("Old playback failure"));
  await first; await flushVue();
  assert.equal(view.colleague.live.value, true);
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.colleague.error.value, "");
});

test("a cancelled live microphone permission cannot end a newer live attempt", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const first = view.colleague.toggleLive();
  await flushVue();
  await view.colleague.toggleLive();
  const second = view.colleague.toggleLive();
  await flushVue(); view.media[1].resolve(); await second;
  view.media[0].resolve(); await first;
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.colleague.live.value, true);
  assert.equal(view.voice.listening.value, true);
});

test("Colleague finishes a short tool acknowledgement while work continues, then speaks the answer once", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const conversation = view.colleagueProps.conversation;
  conversation.status = "working";
  const progress = { id: "request:progress", streamId: "checking", role: "assistant", status: "completed", text: "Let me check your projects." };
  conversation.streamingReply = progress;
  await flushVue();
  const socket = view.sockets[0];
  const first = controls(socket).find(control => control.type === "speak.start");
  assert.equal(first.text, progress.text, "a complete short sentence needs no later reply token to start speech");
  assert.equal(controls(socket).filter(control => control.type === "speak.end").length, 1);
  socket.receive({ type: "speech.start", turnId: first.turnId });
  socket.receive({ type: "speech.segment.start", turnId: first.turnId, segmentIndex: 0 });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: first.turnId });
  socket.receive({ type: "speech.end", turnId: first.turnId });
  await flushVue();
  view.sources[0].finish();
  await flushVue();
  assert.equal(view.voice.activeSpeechTurnId.value, "");
  assert.equal(conversation.status, "working");
  conversation.streamingReply = { ...progress };
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1, "polling the same acknowledgement cannot replay it");
  conversation.streamingReply = { id: "request:assistant", streamId: "answer", role: "assistant", status: "inProgress", text: "One project is open. " };
  await flushVue();
  conversation.messages = [{ id: "request:assistant", role: "assistant", text: "One project is open." }];
  conversation.streamingReply = null;
  conversation.status = "ready";
  await flushVue();
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.start").map(control => control.text), [progress.text, "One project is open."]);
});

test("Stop speaking suppresses a later tool acknowledgement without stopping work", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  view.colleague.stopSpeech();
  view.colleagueProps.conversation.status = "working";
  view.colleagueProps.conversation.streamingReply = { id: "request:progress", status: "completed", role: "assistant", text: "Let me check that." };
  await flushVue();
  assert.equal(view.sockets.length, 0);
  assert.equal(view.colleagueProps.conversation.status, "working");
});

test("Colleague speaks a partial reply and prefetches the next phrase without replaying its final answer", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  view.colleagueProps.conversation.streamingReply = { id: "reply", streamId: "step", role: "assistant", text: "First sentence. More is coming" };
  await flushVue();
  const socket = view.sockets[0];
  const start = controls(socket).find(control => control.type === "speak.start");
  assert.equal(start.text, "First sentence.");
  assert.equal(start.stream, true);
  assert.equal(view.colleagueProps.conversation.messages.length, 0);
  socket.receive({ type: "speech.start", turnId: start.turnId });
  socket.receive({ type: "speech.segment.start", turnId: start.turnId, segmentIndex: 0 });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: start.turnId });
  await flushVue();
  view.colleagueProps.conversation.streamingReply.text += " next. ";
  await flushVue();
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.append").map(control => control.text), ["More is coming next."]);
  assert.equal(view.sources[0].stopped, false, "next synthesis overlaps current playback");
  view.colleagueProps.conversation.messages = [{ id: "reply", role: "assistant", text: "First sentence. More is coming next." }];
  view.colleagueProps.conversation.streamingReply = null;
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1);
  assert.equal(controls(socket).filter(control => control.type === "speak.append").length, 1);
  assert.equal(controls(socket).filter(control => control.type === "speak.end").length, 1);
  assert.equal(view.sources[0].stopped, false, "trimming the final reply's trailing space must not cancel playback");
});

test("microphone mute pauses PCM without ending the utterance or creating a review", async (t) => {
  const view = mountVoice(t, { colleague: true });
    await view.colleague.toggleReadAloud();
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  await view.speak("I can keep speaking while you mute your microphone", "answer");
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "speech.start", turnId: "answer" });
  socket.receive(new Int16Array([1, 2]).buffer);
  socket.receive({ type: "transcript.partial", turnId, text: "I meant A", revision: 1 });
  await flushVue();
  const before = controls(socket).length;
  view.worklets[0].emit(new Float32Array([0.2, -0.2]));
  const frames = socket.sent.filter(frame => typeof frame !== "string").length;
  await view.colleague.toggleMicrophoneMuted();
  view.worklets[0].emit(new Float32Array([0.4, -0.4]));
  socket.receive({ type: "transcript.endpoint", turnId, text: "I meant A", revision: 1 });
  await flushVue();
  assert.equal(view.colleague.microphoneMuted.value, true);
  assert.equal(view.media[0].track.enabled, false);
  assert.equal(view.worklets[0].muted, true);
  assert.equal(view.media[0].stops, 0);
  assert.equal(view.voice.activeListenTurnId.value, turnId);
  assert.equal(view.voice.activeSpeechTurnId.value, "answer");
  assert.equal(view.sources[0].stopped, false);
  assert.equal(controls(socket).length, before, "mute sends neither cancel nor commit");
  assert.equal(socket.sent.filter(frame => typeof frame !== "string").length, frames, "muted PCM never reaches the socket");
  assert.equal(view.voice.inputLevel.value, 0);
  assert.equal(deliveries.length, 0);
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.colleague.heldReview.value, false);
  assert.equal(view.voice.partialTranscript.value, "I meant A");
  await view.colleague.toggleMicrophoneMuted();
  assert.equal(view.media[0].track.enabled, true);
  assert.equal(view.worklets[0].muted, false);
  assert.equal(view.media.length, 1, "unmute reuses the existing microphone");
  assert.equal(deliveries.length, 0, "unmute never submits a partial instruction");
  view.worklets[0].emit(new Float32Array([0.3, -0.3]));
  assert.equal(socket.sent.filter(frame => typeof frame !== "string").length, frames + 1);
  socket.receive({ type: "transcript.partial", turnId, text: "I meant A with sugar", revision: 2 });
  socket.receive({ type: "transcript.endpoint", turnId, text: "I meant A with sugar", revision: 2 });
  await flushVue();
  socket.receive({ type: "transcript.final", turnId, text: "I meant A with sugar", revision: 2, continuous: true });
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], "I meant A with sugar");
});

test("muting during microphone permission starts muted and unmount still releases capture", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const starting = view.colleague.toggleLive();
  await flushVue();
  await view.colleague.toggleMicrophoneMuted();
  view.media[0].resolve();
  await starting;
  assert.equal(view.media[0].track.enabled, false);
  assert.equal(view.colleague.pendingTranscript.value, null);
  view.worklets[0].emit(new Float32Array([0.7]));
  assert.equal(view.sockets[0].sent.some(frame => typeof frame !== "string"), false);
  view.unmount();
  await flushVue();
  assert.equal(view.media[0].stops, 1);
});

test("mute does not lose a previously committed question or reuse its next message identity", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.endpoint", turnId, text: "What about sugar?", revision: 1 });
  await flushVue();
  await view.colleague.toggleMicrophoneMuted();
  socket.receive({ type: "transcript.final", turnId, text: "What about sugar?", revision: 1, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 2 });
  await flushVue();
  assert.equal(deliveries.length, 1);
  const previousId = deliveries[0][1].messageId;
  await view.colleague.toggleMicrophoneMuted();
  socket.receive({ type: "transcript.partial", turnId, text: "What about honey?", revision: 3 });
  await flushVue();
  assert.notEqual(view.emitted.filter(([name]) => name === "transcript").at(-1)[1].id, previousId);
});

test("live questions commit immediately without a Helper and stale revisions never submit", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const deliveries = [];
  view.colleagueProps.classify = () => assert.fail("no Helper round trip before the answer");
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  assert.equal(controls(socket).find(control => control.type === "listen.start").continuous, true);
  socket.receive({ type: "transcript.partial", turnId, text: "I meant A", revision: 1 });
  socket.receive({ type: "transcript.endpoint", turnId, text: "I meant A", revision: 1 });
  await flushVue();
  assert.deepEqual(controls(socket).filter(control => control.type === "listen.commit"), [{ type: "listen.commit", turnId, revision: 1 }]);
  assert.equal(deliveries.length, 0, "local endpoint alone never authorizes a request");
  socket.receive({ type: "transcript.stale", turnId, revision: 1 });
  socket.receive({ type: "transcript.partial", turnId, text: "I meant A with sugar", revision: 2 });
  socket.receive({ type: "transcript.endpoint", turnId, text: "I meant A with sugar", revision: 2 });
  await flushVue();
  socket.receive({ type: "transcript.final", turnId, text: "obsolete", revision: 1, continuous: true });
  await flushVue();
  assert.equal(deliveries.length, 0);
  const completed = { type: "transcript.final", turnId, text: "I meant A with sugar", revision: 2, continuous: true };
  socket.receive(completed);
  socket.receive({ type: "transcript.reset", turnId, revision: 3 });
  await flushVue();
  socket.receive(completed);
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], "I meant A with sugar");
  assert.equal(view.media[0].stops, 0);
  assert.equal(view.voice.listening.value, true);
});

for (const text of ["Yes", "No", "With sugar", "What is it for?", "Do not stop talking", "What does stop talking mean?"]) {
  test(`live speech sends a normal request for ${JSON.stringify(text)}`, async (t) => {
    const view = mountVoice(t, { colleague: true });
    const delivered = [];
    view.colleagueProps.submit = async (...args) => delivered.push(args);
    const starting = view.colleague.toggleLive();
    await flushVue(); view.media[0].resolve(); await starting;
    const socket = view.sockets[0];
    const turnId = view.voice.activeListenTurnId.value;
    socket.receive({ type: "transcript.endpoint", turnId, text, revision: 1 });
    await flushVue();
    assert.ok(controls(socket).some(control => control.type === "listen.commit"));
    socket.receive({ type: "transcript.final", turnId, text, revision: 1, continuous: true });
    await flushVue();
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0][0], text);
  });
}

test("local hesitation waits for more words, while noise, mm-hmm and exact speech echoes leave playback alone", async (t) => {
  const view = mountVoice(t, { colleague: true });
    await view.colleague.toggleReadAloud();
  view.colleagueProps.submit = () => assert.fail("no user request was accepted");
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  view.colleagueProps.conversation.messages = [{ id: "answer", role: "assistant", text: "Here is an explanation of tea." }];
  await flushVue();
  const speech = controls(socket).find(control => control.type === "speak.start");
  socket.receive({ type: "speech.start", turnId: speech.turnId });
  socket.receive(new Int16Array([1, 2]).buffer);
  socket.receive({ type: "transcript.endpoint", turnId, text: "I was thinking um", revision: 1 });
  await flushVue();
  assert.equal(controls(socket).some(control => control.type === "listen.commit" || control.type === "listen.discard"), false);
  for (const [index, text] of ["[cough]", "Mm-hmm", "...", "Here is an explanation of tea"].entries()) {
    socket.receive({ type: "transcript.endpoint", turnId, text, revision: index + 2 });
    await flushVue();
  }
  assert.equal(controls(socket).filter(control => control.type === "listen.discard").length, 4);
  assert.equal(view.sources[0].stopped, false);
  assert.equal(view.voice.listening.value, true);
});

test("a dropped microphone connection preserves partial words for review without executing them", async (t) => {
  const view = mountVoice(t, { colleague: true });
  let sends = 0;
  view.colleagueProps.submit = async () => { sends += 1; };
  const starting = view.colleague.talk();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  socket.receive({ type: "transcript.partial", turnId: view.voice.activeListenTurnId.value, text: "Move the project to" });
  await flushVue();
  socket.close();
  await flushVue();
  assert.equal(sends, 0);
  assert.equal(view.colleague.pendingTranscript.value.text, "Move the project to");
  assert.equal(view.colleague.heldReview.value, false, "ordinary recordings stay in chat instead of opening the held-avatar overlay");
  assert.match(view.colleague.error.value, /incomplete/);
});

test("a stale discard keeps the live utterance identity and its original destination", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const delivered = [];
  view.colleagueProps.submit = async (...args) => delivered.push(args);
  const originalFocus = { ...view.colleagueProps.focus };
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "[cough]", revision: 1 });
  await flushVue();
  const preview = view.emitted.filter(([name]) => name === "transcript").at(-1)[1];
  view.colleagueProps.focus = { projectSlug: "another-project", sessionId: "another-session" };
  socket.receive({ type: "transcript.endpoint", turnId, text: "[cough]", revision: 1 });
  await flushVue();
  assert.ok(controls(socket).some(control => control.type === "listen.discard"));
  socket.receive({ type: "transcript.stale", turnId, revision: 1 });
  socket.receive({ type: "transcript.partial", turnId, text: "Change the title", revision: 2 });
  await flushVue();
  assert.equal(view.emitted.filter(([name]) => name === "transcript").at(-1)[1].id, preview.id);
  socket.receive({ type: "transcript.endpoint", turnId, text: "Change the title", revision: 2 });
  await flushVue();
  socket.receive({ type: "transcript.final", turnId, text: "Change the title", revision: 2, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 3 });
  await flushVue();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][1].messageId, preview.id);
  assert.deepEqual(delivered[0][1].focus, originalFocus);
  socket.receive({ type: "transcript.partial", turnId, text: "Next question", revision: 4 });
  await flushVue();
  assert.notEqual(view.emitted.filter(([name]) => name === "transcript").at(-1)[1].id, preview.id);
});

for (const command of ["Stop talking", "Stap talking", "Wait, let me explain", "Please let me finish"]) {
test(`live partial words retain their chat identity and ${JSON.stringify(command)} discards only voice`, async (t) => {
  const view = mountVoice(t, { colleague: true });
    await view.colleague.toggleReadAloud();
  const delivered = [];
  view.colleagueProps.submit = async (...args) => delivered.push(args);
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "What about sugar", revision: 1 });
  await flushVue();
  const preview = view.emitted.filter(([name]) => name === "transcript").at(-1)[1];
  assert.equal(preview.text, "What about sugar");
  socket.receive({ type: "transcript.endpoint", turnId, text: preview.text, revision: 1 });
  await flushVue();
  socket.receive({ type: "transcript.final", turnId, text: preview.text, revision: 1, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 2 });
  await flushVue();
  assert.equal(delivered[0][1].messageId, preview.id);
  await view.speak("An answer in progress", "answer");
  socket.receive({ type: "speech.start", turnId: "answer" });
  socket.receive(new Int16Array([1, 2]).buffer);
  await flushVue();
  socket.receive({ type: "transcript.partial", turnId, text: command, revision: 3 });
  await new Promise(resolve => setTimeout(resolve, 150));
  await flushVue();
  assert.equal(view.sources[0].stopped, true);
  assert.equal(view.voice.listening.value, true);
  socket.receive({ type: "transcript.endpoint", turnId, text: command, revision: 3 });
  await flushVue();
  assert.equal(delivered.length, 1, "silence commands do not reach the work agent");
  assert.ok(controls(socket).some(control => control.type === "listen.discard" && control.revision === 3));
});
}

test("reconnection opens only the transport and never replays speech or reopens the microphone", async (t) => {
  const view = mountVoice(t, { colleague: true });
    await view.colleague.toggleReadAloud();
  const starting = view.colleague.talk();
  await flushVue(); view.media[0].resolve(); await starting;
  await view.speak("Already heard answer", "old-answer");
  view.sockets[0].close();
  await flushVue();
  assert.equal(view.voice.reconnecting.value, true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await flushVue();
  assert.equal(view.sockets.length, 2);
  assert.equal(view.voice.ready.value, true);
  assert.equal(view.voice.reconnecting.value, false);
  assert.equal(view.media.length, 1);
  assert.deepEqual(controls(view.sockets[1]), []);
  assert.equal(view.voice.activeSpeechTurnId.value, "");
});

test("a playback-only disconnect keeps the answer in chat without claiming a recording was lost", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  await view.speak("An answer still in chat", "answer");
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "answer" });
  socket.receive(new Int16Array(22050).buffer);
  await flushVue();
  socket.close();
  await flushVue();
  assert.match(view.voice.error.value, /The answer remains in chat/);
  assert.doesNotMatch(view.voice.error.value, /recording/);
  assert.equal(view.sources[0].stopped, true);
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.media.length, 0);
  assert.equal(view.voice.reconnecting.value, true);
});

test("phrase steering retains current audio and rejects late audio from later prefetched phrases", async (t) => {
  const view = mountVoice(t, { speechEnabled: true });
  await view.speak("First. Second.", "answer");
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "answer" });
  socket.receive({ type: "speech.segment.start", turnId: "answer", segmentIndex: 0 });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.segment.start", turnId: "answer", segmentIndex: 1 });
  socket.receive(new Int16Array(22050).buffer);
  await flushVue();
  view.voice.finishCurrentPhrase();
  assert.equal(view.sources[0].stopped, false);
  assert.equal(view.sources[1].stopped, true);
  socket.receive(new Int16Array(22050).buffer);
  await flushVue();
  assert.equal(view.sources.length, 2, "late frames beyond the phrase boundary are dropped");
  socket.receive({ type: "speech.end", turnId: "answer" });
  view.sources[0].finish();
  assert.equal(view.voice.activeSpeechTurnId.value, "");
});

test("page suspension releases the microphone and retains unfinished words for review", async (t) => {
  const view = mountVoice(t, { colleague: true });
  const starting = view.colleague.talk();
  await flushVue(); view.media[0].resolve(); await starting;
  const turnId = view.voice.activeListenTurnId.value;
  view.sockets[0].receive({ type: "transcript.partial", turnId, text: "Move the" });
  await flushVue();
  window.dispatchEvent(new Event("pagehide"));
  await flushVue();
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.voice.listening.value, false);
  assert.equal(view.voice.reconnecting.value, false);
  assert.equal(view.colleague.pendingTranscript.value.text, "Move the");
  assert.equal(view.colleague.pendingTranscript.value.reviewBeforeSend, true);
});

test("a healthy socket cannot leave stalled synthesis preparing forever", async (t) => {
  let now = 1000;
  let heartbeat;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback) => { heartbeat = callback; return 0; });
  const view = mountVoice(t, { speechEnabled: true });
  await view.speak("An answer that never produces audio", "stalled");
  const socket = view.sockets[0];
  socket.receive({ type: "speech.start", turnId: "stalled" });
  assert.equal(view.voice.speaking.value, false);
  for (let step = 0; step < 6; step += 1) {
    now += 4000;
    socket.receive({ type: "pong" });
    heartbeat();
  }
  await flushVue();
  assert.match(view.voice.error.value, /Speech generation stalled/);
  assert.equal(socket.readyState, 3);
  assert.equal(view.voice.activeSpeechTurnId.value, "");
});


test("closing a voice target awaits disposal of a late microphone permission grant", async t => {
  const view = mountVoice(t);
  const starting = view.start();
  await flushVue();
  let closed = false;
  const closing = view.voice.close().then(() => { closed = true; });
  await flushVue();
  assert.equal(closed, false);
  view.media[0].resolve();
  await starting;
  await closing;
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.voice.listening.value, false);
  assert.equal(closed, true);
});

test("the first hold starts its connection automatically and release sends one message", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const press = view.colleague.startPushToTalk();
  await flushVue();
  assert.equal(view.colleague.live.value, true);
  assert.equal(view.media.length, 1);
  view.media[0].resolve(); await press;
  const turnId = view.voice.activeListenTurnId.value;
  await view.colleague.finishPushToTalk();
  view.sockets[0].receive({ type: "transcript.final", turnId, text: "First held request." });
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], "First held request.");
  assert.equal(view.media[0].stops, 1);
});

test("releasing the first hold during connection never opens a late microphone", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null, autoReady: false });
  const press = view.colleague.startPushToTalk(); await flushVue();
  assert.equal(view.sockets.length, 1);
  await view.colleague.finishPushToTalk();
  view.sockets[0].ready(); await press; await flushVue();
  assert.equal(view.media.length, 0);
  assert.equal(view.colleague.pushHolding.value, false);
  assert.equal(view.colleague.live.value, false);
});

test("a hold takes over hands-free and retains its current words until release", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const tapped = view.colleague.toggleHandsFree(); await flushVue();
  view.media[0].resolve(); await tapped;
  const socket = view.sockets[0]; const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "Keep these words", revision: 1 });
  await flushVue();
  await view.colleague.startPushToTalk();
  assert.equal(view.media[0].track.enabled, true);
  assert.equal(view.media.length, 1);
  assert.equal(view.voice.activeListenTurnId.value, turnId);
  socket.receive({ type: "transcript.endpoint", turnId, text: "Keep these words", revision: 1 });
  await flushVue();
  assert.equal(controls(socket).some(control => control.type === "listen.commit"), false);
  await view.colleague.finishPushToTalk();
  socket.receive({ type: "transcript.final", turnId, text: "Keep these words and the rest." });
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], "Keep these words and the rest.");
});

test("Pause flushes the last audio and sends the complete utterance once before any resume", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const starting = view.colleague.toggleHandsFree(); await flushVue();
  view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "I am doing O", revision: 1 });
  await flushVue();
  view.colleagueProps.focus = { projectSlug: "other", sessionId: "session-b" };
  view.worklets[0].holdFlush = true;
  const framesBefore = socket.sent.filter(frame => typeof frame !== "string").length;
  const pausing = view.colleague.toggleHandsFree(); await flushVue();
  assert.equal(view.voice.captureState.value, "transcribing");
  assert.equal(controls(socket).some(control => control.type === "listen.stop"), false, "finalization waits for the audio tail");
  socket.receive({ type: "transcript.endpoint", turnId, text: "I am doing O", revision: 1 });
  await flushVue();
  assert.equal(controls(socket).some(control => control.type === "listen.commit"), false, "an endpoint cannot race the explicit Pause boundary");
  view.worklets[0].finishFlush(new Float32Array([.4, -.4]));
  await pausing;
  assert.equal(socket.sent.filter(frame => typeof frame !== "string").length, framesBefore + 1, "the buffered last sound reaches recognition before muting");
  assert.deepEqual(controls(socket).filter(control => control.type === "listen.stop"), [{ type: "listen.stop", turnId }]);
  assert.equal(view.colleague.microphoneMuted.value, true);
  assert.equal(view.media[0].stops, 1);
  socket.receive({ type: "transcript.final", turnId, text: "I am doing OK" });
  await flushVue();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], "I am doing OK");
  assert.equal(deliveries[0][1].focus.projectSlug, "example");
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.media.length, 1, "Pause never restarts capture after admission");
  socket.receive({ type: "transcript.final", turnId, text: "I am doing OK" });
  const resuming = view.colleague.toggleHandsFree(); await flushVue();
  view.media[1].resolve(); await resuming;
  socket.receive({ type: "transcript.partial", turnId, text: "K", revision: 2 });
  await flushVue();
  assert.equal(view.voice.partialTranscript.value, "", "late words from the finished recording cannot leak into the next one");
  assert.equal(deliveries.length, 1);
});

test("Pause with no new words is quiet and does not leave a review or false error", async t => {
  const view = mountVoice(t, { colleague: true, callMode: null });
  const deliveries = [];
  view.colleagueProps.submit = async (...args) => deliveries.push(args);
  const starting = view.colleague.toggleHandsFree(); await flushVue();
  view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  await view.colleague.toggleHandsFree();
  socket.receive({ type: "transcript.final", turnId, text: "" });
  await flushVue();
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.colleague.microphoneMuted.value, true);
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.colleague.error.value, "");
  assert.equal(deliveries.length, 0);
});

test("canonical voice projection retains the original project identities and excludes activity", () => {
  const turns = [{
    turnId: "saved", user: { messageId: "request", text: "Question" },
    assistant: { messageId: "native-final", text: "Earlier answer." },
    commentary: [{ messageId: "progress", role: "commentary", text: "Checking." }],
    thinking: [{ messageId: "reasoning", role: "thinking", text: "Private reasoning." }]
  }, {
    turnId: "current", user: { text: "Follow up" }, pending: true,
    assistant: { messageId: "native-stream", text: "The answer is arriving.", status: "inProgress" }
  }];
  const original = structuredClone(turns);
  const state = projectConversationVoiceState({ turns, status: "working" });
  assert.deepEqual(state.messages.map(({ id, role }) => ({ id, role })), [
    { id: "request", role: "user" }, { id: "saved:assistant", role: "assistant" }, { id: "current:user", role: "user" }
  ]);
  assert.equal(state.streamingReply.id, "current:assistant");
  assert.equal(state.streamingReply.messageId, "native-stream", "The projection does not rewrite the native receipt.");
  assert.equal(state.status, "working");
  assert.deepEqual(turns, original);
});

test("canonical voice projection speaks temporary and saved native answer identities only once", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const user = { messageId: "request", role: "user", text: "Question" };
  const assistant = { messageId: "temporary-block", role: "assistant", text: "First sentence. More is coming", status: "inProgress" };
  const turn = { turnId: "canonical-turn", user, assistant, pending: true };
  Object.assign(view.colleagueProps.conversation, projectConversationVoiceState({ turns: [turn], status: "working" }));
  await flushVue();
  const socket = view.sockets[0];
  const start = controls(socket).find(control => control.type === "speak.start");
  assert.equal(start.text, "First sentence.");
  assert.equal(start.stream, true);
  assert.equal(view.colleagueProps.conversation.streamingReply.id, "canonical-turn:assistant");
  socket.receive({ type: "speech.start", turnId: start.turnId });
  socket.receive({ type: "speech.segment.start", turnId: start.turnId, segmentIndex: 0 });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: start.turnId });
  await flushVue();
  assistant.text += " next. ";
  Object.assign(view.colleagueProps.conversation, projectConversationVoiceState({ turns: [turn], status: "working" }));
  await flushVue();
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.append").map(control => control.text), ["More is coming next."]);
  assert.equal(view.sources[0].stopped, false, "next synthesis overlaps current playback");
  const final = { ...turn, pending: false, assistant: { messageId: "saved-native-uuid", text: "First sentence. More is coming next." } };
  Object.assign(view.colleagueProps.conversation, projectConversationVoiceState({ turns: [final], status: "ready" }));
  await flushVue();
  assert.equal(view.colleagueProps.conversation.messages.at(-1).id, "canonical-turn:assistant");
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1);
  assert.equal(controls(socket).filter(control => control.type === "speak.append").length, 1);
  assert.equal(controls(socket).filter(control => control.type === "speak.end").length, 1);
  assert.equal(view.sources[0].stopped, false, "trimming the final reply's trailing space must not cancel playback");
});

test("canonical voice projection suppresses autonomous partials and speaks the saved notification once", async (t) => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const turn = { turnId: "notification", system: { messageId: "wake", origin: "application", text: "A watched update." }, pending: true,
    assistant: { messageId: "native-partial", role: "assistant", origin: "application", status: "inProgress", text: "The watched work is" } };
  Object.assign(view.colleagueProps.conversation, projectConversationVoiceState({ turns: [turn], status: "working" }));
  await flushVue();
  assert.equal(view.colleagueProps.conversation.streamingReply.id, "notification:assistant:stream");
  assert.equal(view.colleagueProps.conversation.streamingReply.autonomous, true);
  assert.equal(view.colleague.voiceAnswer.value, "The watched work is");
  assert.deepEqual(view.colleagueProps.conversation.messages, []);
  assert.equal(view.sockets.length, 0, "An autonomous partial is a caption, not a speech invitation.");
  const final = { ...turn, pending: false, assistant: { messageId: "saved-notification", text: "The watched work is complete." } };
  const state = projectConversationVoiceState({ turns: [final], status: "ready" });
  Object.assign(view.colleagueProps.conversation, state);
  await flushVue();
  const socket = view.sockets[0];
  assert.equal(state.messages[0].id, "notification:assistant");
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.start").map(control => control.text), ["The watched work is complete."]);
  Object.assign(view.colleagueProps.conversation, projectConversationVoiceState({ turns: [final], status: "ready" }));
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1, "A canonical refresh cannot replay the notification.");
});

test("canonical output identity finishes a spoken acknowledgement and keeps the later answer separate", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const user = { messageId: "request", role: "user", text: "Check my projects." };
  const progress = { messageId: "live-progress", outputId: "request:provider-progress", role: "assistant",
    text: "Let me check your projects. ", status: "inProgress" };
  const turn = { turnId: "canonical-turn", user, assistant: progress, pending: true };
  const project = input => Object.assign(view.colleagueProps.conversation, projectConversationVoiceState(input));
  project({ turns: [turn], status: "working" });
  await flushVue();
  const socket = view.sockets[0];
  const start = controls(socket).find(control => control.type === "speak.start");
  assert.equal(start.text, progress.text.trim());
  assert.equal(view.colleagueProps.conversation.streamingReply.id, progress.outputId);
  socket.receive({ type: "speech.start", turnId: start.turnId });
  socket.receive({ type: "speech.segment.start", turnId: start.turnId, segmentIndex: 0 });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: start.turnId });
  await flushVue();

  const savedProgress = { ...progress, messageId: "saved-progress", role: "commentary", text: progress.text.trim(), status: "complete" };
  const interimReply = { ...savedProgress, id: "product-selection", role: "assistant", status: "completed" };
  const withProgress = { ...turn, assistant: null, commentary: [savedProgress] };
  project({ turns: [withProgress], status: "working", interimReply });
  await flushVue();
  assert.equal(view.colleagueProps.conversation.streamingReply.id, progress.outputId);
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1,
    "Selecting the completed form of already spoken output must not replay it.");
  assert.equal(controls(socket).filter(control => control.type === "speak.end").length, 1);
  assert.equal(view.sources[0].stopped, false);
  socket.receive({ type: "speech.end", turnId: start.turnId });
  await flushVue();
  view.sources[0].finish();
  await flushVue();
  project({ turns: [withProgress], status: "working", interimReply: { ...interimReply } });
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1);

  const answer = { messageId: "live-answer", outputId: "request:provider-answer", role: "assistant",
    text: "One project is open. ", status: "inProgress" };
  project({ turns: [{ ...withProgress, assistant: answer }], status: "working", interimReply: null });
  await flushVue();
  const final = { ...withProgress, pending: false, assistant: { ...answer, messageId: "saved-answer", text: answer.text.trim(), status: "complete" } };
  project({ turns: [final], status: "ready" });
  await flushVue();
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.start").map(control => control.text),
    [progress.text.trim(), answer.text.trim()]);
  assert.equal(view.colleagueProps.conversation.messages.at(-1).id, answer.outputId);
  assert.equal(view.colleagueProps.conversation.messages.at(-1).messageId, "saved-answer");
  project({ turns: [final], status: "ready" });
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 2);
  assert.equal(final.commentary[0].messageId, "saved-progress");
});


for (const microphone of [false, true]) {
  for (const speaker of [false, true]) {
    test(`microphone ${microphone ? "on" : "off"} and speaker ${speaker ? "on" : "off"} remain independent`, async t => {
      const view = mountVoice(t, { colleague: true, defaults: { readAloud: speaker } });
      assert.equal(view.media.length, 0);
      assert.equal(view.contexts.length, 0, "hydrating a preference does not start audio");
      if (microphone) {
        const starting = view.colleague.toggleLive();
        await flushVue(); view.media[0].resolve(); await starting;
      }
      view.colleagueProps.conversation.messages = [{ id: "answer", role: "assistant", text: "An ordinary answer." }];
      await flushVue();
      assert.equal(view.voice.listening.value, microphone);
      assert.equal(view.colleague.readAloud.value, speaker);
      assert.equal(view.media.length, microphone ? 1 : 0);
      const starts = view.sockets.flatMap(controls).filter(control => control.type === "speak.start");
      assert.equal(starts.length, speaker ? 1 : 0);
      assert.deepEqual(view.emitted.filter(([kind]) => kind === "readAloud"), []);
      if (speaker) {
        const socket = view.sockets[0];
        socket.receive({ type: "speech.start", turnId: starts[0].turnId });
        socket.receive(new Int16Array(22050).buffer);
        await flushVue();
        if (microphone) await view.colleague.toggleLive();
        assert.equal(view.sources[0].stopped, false, "ending capture preserves the current reply");
        assert.equal(view.colleague.readAloud.value, true);
        assert.equal(view.voice.listening.value, false);
      }
    });
  }
}

for (const steering of ["push", "hands-free", "typed"]) {
  test(`ordinary ${steering} steering preserves current and queued playback`, async t => {
    const view = mountVoice(t, { colleague: true, callMode: steering === "push" ? "push-to-talk" : "hands-free" });
    await view.colleague.toggleReadAloud();
    view.colleagueProps.conversation.messages = [
      { id: "first", role: "assistant", text: "First answer." },
      { id: "second", role: "assistant", text: "Queued answer." }
    ];
    await flushVue();
    const socket = view.sockets[0];
    const first = controls(socket).find(control => control.type === "speak.start");
    socket.receive({ type: "speech.start", turnId: first.turnId });
    socket.receive({ type: "speech.segment.start", turnId: first.turnId, segmentIndex: 0 });
    socket.receive(new Int16Array(22050).buffer);
    socket.receive({ type: "speech.segment.start", turnId: first.turnId, segmentIndex: 1 });
    socket.receive(new Int16Array(22050).buffer);
    socket.receive({ type: "speech.end", turnId: first.turnId });
    await flushVue();
    if (steering === "typed") {
      view.colleague.inviteSpeech("typed-request");
      view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
        { id: "typed-request", role: "user", text: "Now explain another part." }];
    } else {
      const starting = steering === "push" ? view.colleague.startPushToTalk() : view.colleague.toggleLive();
      await flushVue(); view.media[0].resolve(); await starting;
      const turnId = view.voice.activeListenTurnId.value;
      socket.receive({ type: "transcript.partial", turnId, text: "Now explain another part.", revision: 1 });
      if (steering === "hands-free") socket.receive({ type: "transcript.endpoint", turnId, text: "Now explain another part.", revision: 1 });
      else await view.colleague.finishPushToTalk();
    }
    await flushVue();
    assert.ok(view.sources.every(source => !source.stopped), "all prefetched phrases survive ordinary steering");
    assert.equal(controls(socket).filter(control => ["cancel", "speak.stop-after"].includes(control.type) && control.turnId === first.turnId).length, 0);
    for (const source of [...view.sources]) source.finish();
    await flushVue();
    assert.deepEqual(controls(socket).filter(control => control.type === "speak.start").map(control => control.text), ["First answer.", "Queued answer."]);
  });
}

test("playback receipts use canonical output identity and actual audio start and drain", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const progress = { id: "output", outputId: "canonical-output", role: "assistant", text: "An answer. ", status: "inProgress" };
  view.colleagueProps.conversation.streamingReply = progress;
  await flushVue();
  const socket = view.sockets[0];
  const start = controls(socket).find(control => control.type === "speak.start");
  const events = () => view.emitted.filter(([kind]) => kind === "playback").map(([, value]) => value);
  assert.deepEqual(events(), [], "text and synthesis request are not audible playback");
  socket.receive({ type: "speech.start", turnId: start.turnId });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: start.turnId });
  await flushVue();
  view.advancePlayback(view.sources[0].startedAt - 0.001);
  assert.deepEqual(events(), [], "scheduled future PCM has not started");
  view.advancePlayback(view.sources[0].startedAt);
  assert.deepEqual(events(), [{ conversationId: "logical-conversation", outputId: "canonical-output", phase: "started" }]);
  view.advancePlayback(view.sources[0].startedAt + 0.1);
  view.colleagueProps.conversation.streamingReply = { ...progress, text: progress.text.trim(), status: "completed" };
  await flushVue();
  socket.receive({ type: "speech.end", turnId: start.turnId });
  await flushVue();
  assert.equal(events().length, 1, "server end and canonical final still wait for real scheduled audio");
  view.sources[0].finish(); await flushVue();
  assert.deepEqual(events().map(event => event.phase), ["started", "completed"]);
  assert.ok(events().every(event => event.outputId === "canonical-output"));
});

test("speech cap drains without claiming completion before canonical final", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const output = { id: "capped", role: "assistant", text: "Answer ".repeat(572), status: "inProgress" };
  view.colleagueProps.conversation.streamingReply = output; await flushVue();
  const socket = view.sockets[0]; const start = controls(socket).find(control => control.type === "speak.start");
  socket.receive({ type: "speech.start", turnId: start.turnId });
  socket.receive(new Int16Array(22050).buffer);
  socket.receive({ type: "speech.chunk.end", turnId: start.turnId });
  await flushVue();
  // The bounded projection can need several synthesis append acknowledgements.
  for (let i = 0; i < 40; i++) { socket.receive({ type: "speech.chunk.end", turnId: start.turnId }); await flushVue(); }
  assert.ok(controls(socket).some(control => control.type === "speak.end"));
  socket.receive({ type: "speech.end", turnId: start.turnId });
  await flushVue(); view.sources[0].finish(); await flushVue();
  const events = () => view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event.phase);
  assert.deepEqual(events(), ["started"]);
  view.colleagueProps.conversation.streamingReply = { ...output, status: "completed" }; await flushVue();
  assert.deepEqual(events(), ["started", "completed"]);
});

test("Stop interrupts queued outputs once without fictional starts or stale completion", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  view.colleagueProps.onPlayback = () => Promise.reject(new Error("observer failure"));
  view.colleagueProps.onReadAloudChange = () => { throw new Error("preference observer failure"); };
  view.colleagueProps.conversation.messages = [
    { id: "first", role: "assistant", text: "First answer." }, { id: "queued", role: "assistant", text: "Queued answer." }
  ];
  await flushVue();
  const socket = view.sockets[0]; const start = controls(socket).find(control => control.type === "speak.start");
  socket.receive({ type: "speech.start", turnId: start.turnId }); socket.receive(new Int16Array(22050).buffer);
  await flushVue();
  await view.colleague.toggleReadAloud();
  view.sources[0].finish(); socket.receive({ type: "speech.end", turnId: start.turnId }); await flushVue();
  const events = view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event);
  assert.deepEqual(events, [
    { conversationId: "logical-conversation", outputId: "first", phase: "interrupted", reason: "muted" },
    { conversationId: "logical-conversation", outputId: "queued", phase: "interrupted", reason: "muted" }
  ]);
  assert.equal(view.voice.activeSpeechTurnId.value, "");
  assert.equal(view.colleague.readAloud.value, false);
});

test("failed playback and disappearing canonical output each settle once", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  view.colleagueProps.conversation.streamingReply = { id: "retired", role: "assistant", text: "An incomplete answer. ", status: "inProgress" };
  await flushVue();
  view.colleagueProps.conversation.streamingReply = null;
  await flushVue();
  view.colleagueProps.conversation.messages = [{ id: "failed", role: "assistant", text: "Another answer." }];
  await flushVue();
  const socket = view.sockets[0];
  const start = controls(socket).filter(control => control.type === "speak.start").at(-1);
  socket.receive({ type: "error", turnId: start.turnId, message: "Synthesis failed." });
  await flushVue();
  const events = view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event);
  assert.deepEqual(events.map(event => [event.outputId, event.phase]), [["retired", "interrupted"], ["failed", "failed"]]);
  socket.receive({ type: "speech.end", turnId: start.turnId }); await flushVue();
  assert.equal(view.emitted.filter(([kind]) => kind === "playback").length, 2);
});


test("pending sound unlock stays recoverable and late rejection cannot undo the newer unlock", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.voice.preparePlayback();
  const old = Promise.withResolvers();
  t.after(() => old.resolve());
  view.contexts[0].state = "suspended";
  view.contexts[0].nextResume = old.promise;
  const enabling = view.colleague.toggleReadAloud();
  assert.equal(view.voice.playbackBlocked.value, true, "a browser-pending resume exposes Enable sound immediately");
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  assert.equal(view.voice.listening.value, true, "pending sound never gates permission or capture");
  await view.colleague.enableSound();
  assert.equal(view.voice.playbackBlocked.value, false);
  old.reject(new Error("Obsolete blocked resume")); await enabling;
  assert.equal(view.voice.playbackBlocked.value, false);
  assert.equal(view.colleague.readAloud.value, true);
  assert.equal(view.colleague.error.value, "");
});


for (const caller of ["speech request", "queued PCM"]) {
  test(`newer sound unlock supersedes a stale ${caller} resume failure without cancelling capture or output`, async t => {
    const view = mountVoice(t, { colleague: true, defaults: { readAloud: true } });
    const starting = view.colleague.toggleLive();
    await flushVue(); view.media[0].resolve(); await starting;
    const socket = view.sockets[0];
    const pending = Promise.withResolvers();
    t.after(() => pending.resolve());
    let turnId;
    if (caller === "queued PCM") {
      view.colleagueProps.conversation.messages = [{ id: "output", role: "assistant", text: "Recovered reply." }];
      await flushVue();
      turnId = controls(socket).find(control => control.type === "speak.start").turnId;
      socket.receive({ type: "speech.start", turnId });
    }
    view.contexts[0].state = "suspended";
    view.contexts[0].nextResume = pending.promise;
    if (caller === "speech request") {
      view.colleagueProps.conversation.messages = [{ id: "output", role: "assistant", text: "Recovered reply." }];
    } else socket.receive(new Int16Array(22050).buffer);
    await flushVue();
    assert.equal(view.voice.playbackBlocked.value, true);
    await view.colleague.enableSound();
    assert.equal(view.voice.playbackBlocked.value, false);
    pending.reject(new Error("Superseded playback failure"));
    await flushVue();
    turnId ||= controls(socket).find(control => control.type === "speak.start").turnId;
    assert.equal(view.voice.activeSpeechTurnId.value, turnId);
    assert.equal(view.voice.listening.value, true);
    assert.equal(view.media[0].stops, 0);
    assert.equal(view.voice.error.value, "");
    assert.equal(view.colleague.error.value, "");
    if (caller === "speech request") {
      socket.receive({ type: "speech.start", turnId });
      socket.receive(new Int16Array(22050).buffer);
    }
    socket.receive({ type: "speech.end", turnId }); await flushVue();
    view.sources[0].finish(); await flushVue();
    assert.deepEqual(view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event.phase), ["started", "completed"]);
  });
}

for (const unspeakable of ["***", "___", " "]) {
  test(`a final no-audio projection ${JSON.stringify(unspeakable)} retires once and leaves the next output playable`, async t => {
    const view = mountVoice(t, { colleague: true });
    await view.colleague.toggleReadAloud();
    view.colleagueProps.conversation.messages = [
      { id: "no-audio", role: "assistant", text: unspeakable }, { id: "next", role: "assistant", text: "The next reply." }
    ];
    await flushVue();
    assert.deepEqual(view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event), [
      { conversationId: "logical-conversation", outputId: "no-audio", phase: "interrupted", reason: "no-audio" }
    ]);
    assert.deepEqual(controls(view.sockets[0]).filter(control => control.type === "speak.start").map(control => control.text), ["The next reply."]);
    view.colleagueProps.conversation.messages = [];
    await flushVue(); view.colleague.stopSpeech(); await flushVue();
    assert.equal(view.emitted.filter(([kind, event]) => kind === "playback" && event.outputId === "no-audio").length, 1);
  });
}

test("a declined speech request retires its canonical receipt without invented audio completion", async t => {
  const view = mountVoice(t, { colleague: true });
  await view.colleague.toggleReadAloud();
  const speak = view.voice.speak;
  view.voice.speak = async () => false;
  view.colleagueProps.conversation.messages = [{ id: "declined", role: "assistant", text: "A reply with no admitted playback." }];
  await flushVue();
  assert.deepEqual(view.emitted.filter(([kind]) => kind === "playback").map(([, event]) => event), [
    { conversationId: "logical-conversation", outputId: "declined", phase: "interrupted", reason: "no-audio" }
  ]);
  assert.equal(view.sockets.length, 0);
  view.voice.speak = speak;
  view.colleagueProps.conversation.messages = [{ id: "next", role: "assistant", text: "The next reply." }];
  await flushVue();
  assert.equal(controls(view.sockets[0]).find(control => control.type === "speak.start").text, "The next reply.");
  view.colleague.stopSpeech(); await flushVue();
  assert.equal(view.emitted.filter(([kind, event]) => kind === "playback" && event.outputId === "declined").length, 1);
});


test("hands-free keeps new temporary words visible during admission and leaves typing available while listening", async t => {
  const view = mountVoice(t, { colleague: true, defaults: { readAloud: true } });
  let accept;
  const deliveries = [];
  const typedDeliveries = [];
  view.colleagueProps.submit = (text, options) => {
    if (options.messageId === "typed-during-voice") {
      typedDeliveries.push({ text, ...options });
      return Promise.resolve({ ok: true });
    }
    deliveries.push({ text, ...options });
    return new Promise(resolve => { accept = resolve; });
  };
  view.colleagueProps.conversation.status = "working";
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const call = view.colleague;
  assert.equal(call.composerBlocked.value, false, "an open continuous microphone does not block typed steering");
  assert.equal(call.hasUnsentSpeech.value, true, "target-switch protection still owns the open recording");
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  view.colleagueProps.conversation.messages = [{ id: "playing-reply", role: "assistant", text: "Keep this reply playing." }];
  await flushVue();
  const speechId = view.voice.activeSpeechTurnId.value;
  assert.ok(speechId);
  socket.receive({ type: "transcript.partial", turnId, text: "First direction", revision: 1 });
  socket.receive({ type: "transcript.endpoint", turnId, text: "First direction", revision: 1 });
  await flushVue();
  socket.receive({ type: "transcript.final", turnId, text: "First direction", revision: 1, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 2 });
  await flushVue();
  const firstId = call.pendingTranscript.value.messageId;
  assert.equal(call.sending.value, true);
  assert.equal(call.composerBlocked.value, false, "live hands-free admission leaves typed submission to the conversation owner");
  assert.equal(call.hasUnsentSpeech.value, true, "unresolved voice still protects target switching");
  const heldVoice = call.pendingTranscript.value;
  assert.equal(await view.colleagueProps.submit("Typed steering while voice waits", {
    messageId: "typed-during-voice", focus: { ...view.colleagueProps.focus }
  }).then(result => result.ok), true);
  assert.deepEqual(typedDeliveries, [{ text: "Typed steering while voice waits", messageId: "typed-during-voice",
    focus: { projectSlug: "example", sessionId: "session-a" } }]);
  assert.equal(call.pendingTranscript.value, heldVoice, "typed submission does not consume retained voice words");
  assert.equal(call.sending.value, true);
  const pcmBefore = socket.sent.filter(frame => typeof frame !== "string").length;
  view.worklets[0].emit(new Float32Array([0.2, -0.2]));
  assert.equal(socket.sent.filter(frame => typeof frame !== "string").length, pcmBefore + 1, "continuous PCM reaches the socket during admission");
  socket.receive({ type: "transcript.partial", turnId, text: "Another direction while waiting", revision: 3 });
  await flushVue();
  const preview = view.emitted.filter(([name]) => name === "transcript").at(-1)[1];
  assert.equal(preview.text, "Another direction while waiting");
  assert.notEqual(preview.id, firstId);
  assert.equal(call.pendingTranscript.value.text, "First direction", "new words do not overwrite the admitted request");
  view.colleagueProps.focus = { projectSlug: "next-project", sessionId: "next-session" };
  socket.receive({ type: "transcript.endpoint", turnId, text: "Another direction while waiting", revision: 3 });
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 1, "the second endpoint waits for first admission");
  await call.toggleHandsFree();
  assert.equal(call.microphoneMuted.value, true, "Pause remains usable during admission");
  assert.equal(view.media[0].stops, 0);
  await call.toggleHandsFree();
  assert.equal(call.microphoneMuted.value, false);
  accept({ ok: true });
  await flushVue();
  assert.equal(call.pendingTranscript.value, null);
  assert.equal(call.composerBlocked.value, false);
  assert.equal(view.voice.listening.value, true);
  assert.equal(view.emitted.filter(([name]) => name === "transcript").at(-1)[1].text, "Another direction while waiting");
  assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 2, "release commits the waiting endpoint exactly once");
  socket.receive({ type: "transcript.final", turnId, text: "Another direction while waiting", revision: 3, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 4 });
  await flushVue();
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].messageId, firstId);
  assert.equal(deliveries[1].messageId, preview.id);
  assert.deepEqual(deliveries[1].focus, { projectSlug: "example", sessionId: "session-a" }, "the second recording retains its captured focus");
  assert.equal(deliveries[1].text, "Another direction while waiting");
  accept({ ok: true });
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 2);
  assert.equal(deliveries.length, 2);
  assert.equal(view.voice.activeSpeechTurnId.value, speechId);
  assert.equal(controls(socket).some(control => control.type === "cancel" && control.turnId === speechId), false);
});


test("discarding temporary hands-free words restarts only capture and keeps playback and the conversation", async t => {
  const view = mountVoice(t, { colleague: true, defaults: { readAloud: true } });
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const call = view.colleague;
  view.colleagueProps.conversation.status = "working";
  view.colleagueProps.conversation.messages = [{ id: "reply", role: "assistant", text: "Keep this answer playing." }];
  await flushVue();
  const socket = view.sockets[0];
  const speechId = view.voice.activeSpeechTurnId.value;
  const listenId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId: listenId, text: "Discard only these words", revision: 1 });
  await flushVue();
  const [, selected, metadata] = view.emitted.filter(([kind]) => kind === "transcript").at(-1);
  assert.equal(metadata.canTake, true);
  assert.equal(await call.takeTranscript("wrong-preview"), false);
  assert.equal(view.media[0].stops, 0);
  const taking = call.takeTranscript(selected.id);
  await flushVue();
  assert.equal(view.media[0].stops, 1);
  view.media[1].resolve();
  assert.equal(await taking, true);
  assert.equal(call.live.value, true);
  assert.equal(view.voice.listening.value, true);
  assert.notEqual(view.voice.activeListenTurnId.value, listenId);
  assert.equal(view.voice.activeSpeechTurnId.value, speechId);
  assert.ok(speechId, "the accepted reply remains scheduled");
  assert.equal(controls(socket).some(item => item.type === "cancel" && item.turnId === speechId), false);
  socket.receive({ type: "transcript.partial", turnId: listenId, text: "Late discarded words", revision: 2 });
  await flushVue();
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1], null);
  socket.receive({ type: "transcript.partial", turnId: view.voice.activeListenTurnId.value, text: "New direction", revision: 1 });
  await flushVue();
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1].text, "New direction");
});

test("editing a temporary message rechecks the typed draft and transfers exact words before cancelling capture", async t => {
  const view = mountVoice(t, { colleague: true });
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  socket.receive({ type: "transcript.partial", turnId: view.voice.activeListenTurnId.value, text: "Exact selected words", revision: 1 });
  await flushVue();
  const selected = view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1];
  let draft = "Keep my typed request";
  const transfer = text => {
    if (draft) return false;
    assert.equal(view.media[0].stops, 0, "transfer happens before asynchronous capture cleanup");
    draft = text;
    return true;
  };
  assert.equal(await view.colleague.takeTranscript(selected.id, transfer), false);
  assert.equal(draft, "Keep my typed request");
  assert.equal(view.media[0].stops, 0);
  draft = "";
  const taking = view.colleague.takeTranscript(selected.id, transfer);
  assert.equal(draft, selected.text);
  await flushVue(); view.media[1].resolve();
  assert.equal(await taking, true);
  assert.equal(draft, selected.text);
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.voice.listening.value, true);
});

test("temporary message actions cannot cancel committing, sending, or accepted speech", async t => {
  const view = mountVoice(t, { colleague: true });
  let accept;
  view.colleagueProps.submit = () => new Promise(resolve => { accept = resolve; });
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  const socket = view.sockets[0];
  const turnId = view.voice.activeListenTurnId.value;
  socket.receive({ type: "transcript.partial", turnId, text: "Keep admitted words", revision: 1 });
  await flushVue();
  const selected = view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1];
  socket.receive({ type: "transcript.endpoint", turnId, text: selected.text, revision: 1 });
  await flushVue();
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[2].canTake, false);
  assert.equal(await view.colleague.takeTranscript(selected.id), false);
  assert.equal(await view.colleague.beginTranscriptEdit(selected.id), false);
  socket.receive({ type: "transcript.final", turnId, text: selected.text, revision: 1, continuous: true });
  socket.receive({ type: "transcript.reset", turnId, revision: 2 });
  await flushVue();
  assert.equal(view.colleague.sending.value, true);
  socket.receive({ type: "transcript.partial", turnId, text: "New words during admission", revision: 3 });
  await flushVue();
  const next = view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1];
  assert.equal(await view.colleague.takeTranscript(next.id), false);
  assert.equal(await view.colleague.beginTranscriptEdit(next.id), false);
  assert.equal(view.media[0].stops, 0);
  accept({ ok: true }); await flushVue();
  view.colleagueProps.conversation.messages = [{ id: next.id, role: "user", text: next.text }];
  await flushVue();
  assert.equal(await view.colleague.takeTranscript(next.id), false);
  assert.equal(await view.colleague.beginTranscriptEdit(next.id), false);
  assert.equal(view.media[0].stops, 0);
});


test("temporary message controls resolve an interrupted review without admitting or replacing a typed draft", async t => {
  const view = mountVoice(t, { colleague: true });
  const starting = view.colleague.talk();
  await flushVue(); view.media[0].resolve(); await starting;
  view.sockets[0].receive({ type: "transcript.partial", turnId: view.voice.activeListenTurnId.value, text: "Recovered unfinished request" });
  await flushVue();
  window.dispatchEvent(new Event("pagehide"));
  await flushVue();
  const pending = view.colleague.pendingTranscript.value;
  assert.equal(pending.text, "Recovered unfinished request");
  assert.equal(view.colleague.composerBlocked.value, true, "one-off recovery still requires resolution before a competing typed send");
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[2].canTake, true);
  assert.equal(await view.colleague.takeTranscript(pending.messageId, () => false), false);
  assert.equal(view.colleague.pendingTranscript.value, pending);
  let draft = "";
  assert.equal(await view.colleague.takeTranscript(pending.messageId, text => { draft = text; return true; }), true);
  assert.equal(draft, pending.text);
  assert.equal(view.colleague.pendingTranscript.value, null);
  assert.equal(view.media.length, 1);
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.voice.listening.value, false);
});


test("editing speech keeps its exact pending identity and destination without changing playback or typing", async t => {
  const view = mountVoice(t, { colleague: true, defaults: { readAloud: true } });
  const attempts = [];
  let failed = true;
  view.colleagueProps.submit = async (text, options) => {
    attempts.push({ text, ...options });
    if (failed) throw new Error("Not admitted; keep these words.");
    return { ok: true };
  };
  const starting = view.colleague.toggleLive();
  await flushVue(); view.media[0].resolve(); await starting;
  view.colleagueProps.conversation.status = "working";
  view.colleagueProps.conversation.messages = [{ id: "playing", role: "assistant", text: "Keep speaking this answer." }];
  await flushVue();
  const call = view.colleague;
  const socket = view.sockets[0];
  const listenId = view.voice.activeListenTurnId.value;
  const speechId = view.voice.activeSpeechTurnId.value;
  socket.receive({ type: "transcript.partial", turnId: listenId, text: "Exact selected speech", revision: 1 });
  await flushVue();
  const selected = view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1];
  view.colleagueProps.focus = { projectSlug: "another", sessionId: "session-b" };
  assert.equal(await call.beginTranscriptEdit("stale-preview"), false);
  assert.equal(await call.beginTranscriptEdit(selected.id), true);
  await flushVue();
  assert.equal(call.pendingTranscript.value.messageId, selected.id);
  assert.equal(call.pendingTranscript.value.text, selected.text);
  assert.deepEqual(call.pendingTranscript.value.focus, { projectSlug: "example", sessionId: "session-a" });
  assert.equal(call.pendingTranscript.value.editing, true);
  assert.equal(call.composerBlocked.value, false, "a live hands-free bubble editor remains independent of the typed composer");
  assert.equal(call.hasUnsentSpeech.value, true);
  assert.equal(call.live.value, true);
  assert.equal(view.media[0].stops, 1);
  assert.equal(view.media.length, 1, "capture stays paused while the original pending message is edited");
  assert.equal(view.voice.activeSpeechTurnId.value, speechId);
  assert.ok(speechId);
  assert.equal(controls(socket).some(item => item.type === "cancel" && item.turnId === speechId), false);
  call.editTranscript("Wrong message", "stale-preview");
  assert.equal(call.pendingTranscript.value.text, selected.text);
  call.editTranscript("", selected.id);
  await flushVue();
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1].id, selected.id);
  assert.equal(view.emitted.filter(([kind]) => kind === "transcript").at(-1)[1].text, "");
  socket.receive({ type: "transcript.partial", turnId: listenId, text: "Late cancelled speech", revision: 2 });
  await flushVue();
  assert.equal(call.pendingTranscript.value.text, "");
  call.editTranscript("Corrected selected speech", selected.id);
  await call.deliverTranscript();
  assert.equal(call.pendingTranscript.value.text, "Corrected selected speech");
  assert.equal(view.media.length, 1);
  failed = false;
  await call.deliverTranscript();
  await flushVue();
  assert.equal(call.pendingTranscript.value, null);
  assert.equal(view.media.length, 2, "the existing pending-clear watcher resumes hands-free once resolved");
  view.media[1].resolve(); await flushVue();
  assert.deepEqual(attempts, [
    { text: "Corrected selected speech", messageId: selected.id, focus: { projectSlug: "example", sessionId: "session-a" } },
    { text: "Corrected selected speech", messageId: selected.id, focus: { projectSlug: "example", sessionId: "session-a" } }
  ]);
  assert.equal(view.voice.listening.value, true);
  call.editTranscript("Do not fabricate a pending message");
  assert.equal(call.pendingTranscript.value, null);
});


test("unadmitted matching user records retain editable speech and cannot acknowledge a speech invitation", async t => {
  const view = mountVoice(t, { colleague: true });
  const call = view.colleague;
  await call.toggleReadAloud();
  view.colleagueProps.conversation.messages = [{ id: "old-answer", role: "assistant", text: "An earlier answer." }];
  await flushVue();
  const socket = view.sockets[0];
  call.stopSpeech();
  const pending = { messageId: "unadmitted-voice", text: "Review these words", focus: { projectSlug: "example", sessionId: "session-a" } };
  call.pendingTranscript.value = pending;
  call.inviteSpeech(pending.messageId);
  view.colleagueProps.conversation.messages = [
    ...view.colleagueProps.conversation.messages,
    { id: pending.messageId, role: "user", text: pending.text, receipt: false },
    { id: "uninvited-answer", role: "assistant", text: "Not an admitted answer." }
  ];
  await flushVue();
  assert.equal(call.pendingTranscript.value.messageId, pending.messageId);
  assert.equal(await call.beginTranscriptEdit(pending.messageId), true);
  assert.equal(call.pendingTranscript.value.editing, true);
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 1, "unadmitted readback cannot lift Stop");
  view.colleagueProps.conversation.messages = view.colleagueProps.conversation.messages.map(message =>
    message.id === pending.messageId ? { ...message, receipt: true } : message);
  view.colleagueProps.conversation.messages.push({ id: "admitted-answer", role: "assistant", text: "A newly admitted answer." });
  await flushVue();
  assert.equal(call.pendingTranscript.value, null);
  assert.deepEqual(controls(socket).filter(control => control.type === "speak.start").map(control => control.text), ["An earlier answer.", "A newly admitted answer."]);
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages];
  await flushVue();
  assert.equal(controls(socket).filter(control => control.type === "speak.start").length, 2, "repeated admitted readback is processed once");
  call.pendingTranscript.value = { ...pending, messageId: "legacy-admitted" };
  view.colleagueProps.conversation.messages = [...view.colleagueProps.conversation.messages,
    { id: "legacy-admitted", role: "user", text: pending.text }];
  await flushVue();
  assert.equal(call.pendingTranscript.value, null, "canonical records without an explicit receipt flag remain admitted");
});

for (const recovery of ["retry", "edit", "discard", "edit with explicit mute"]) {
  test(`failed voice A ${recovery} preserves newer live B and commits B once`, async t => {
    const view = mountVoice(t, { colleague: true, defaults: { readAloud: true } });
    const deliveries = [];
    let rejectFirst = true;
    view.colleagueProps.submit = async (text, options) => {
      deliveries.push({ text, ...options });
      if (rejectFirst) {
        rejectFirst = false;
        return { ok: false, message: "The first utterance was not admitted." };
      }
      return { ok: true };
    };
    const starting = view.colleague.toggleLive();
    await flushVue(); view.media[0].resolve(); await starting;
    const call = view.colleague;
    const socket = view.sockets[0];
    const turnId = view.voice.activeListenTurnId.value;
    view.colleagueProps.conversation.messages = [{ id: "playing", role: "assistant", text: "Keep this answer playing." }];
    await flushVue();
    const speechId = view.voice.activeSpeechTurnId.value;
    assert.ok(speechId);
    socket.receive({ type: "transcript.partial", turnId, text: "Failed first words", revision: 1 });
    socket.receive({ type: "transcript.endpoint", turnId, text: "Failed first words", revision: 1 });
    await flushVue();
    socket.receive({ type: "transcript.final", turnId, text: "Failed first words", revision: 1, continuous: true });
    socket.receive({ type: "transcript.reset", turnId, revision: 2 });
    await flushVue();
    const first = call.pendingTranscript.value;
    assert.equal(first.text, "Failed first words");
    assert.equal(call.sending.value, false);
    assert.equal(call.error.value, "The first utterance was not admitted.");
    view.colleagueProps.focus = { projectSlug: "newer-project", sessionId: "newer-session" };
    socket.receive({ type: "transcript.partial", turnId, text: "Keep newer live words", revision: 3 });
    socket.receive({ type: "transcript.endpoint", turnId, text: "Keep newer live words", revision: 3 });
    await flushVue();
    const newer = view.emitted.filter(([name]) => name === "transcript").at(-1)[1];
    assert.notEqual(newer.id, first.messageId);
    assert.equal(newer.text, "Keep newer live words");
    assert.equal(call.canTakeTranscript(first.messageId), true, "retained A is recoverable even when current recognition is B");
    assert.equal(call.canTakeTranscript(newer.id), true);
    assert.equal(await call.beginTranscriptEdit(newer.id), false, "B cannot overwrite the one existing pending editor");
    assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 1);
    view.colleagueProps.focus = { projectSlug: "later-project", sessionId: "later-session" };
    if (recovery.startsWith("edit")) {
      assert.equal(await call.beginTranscriptEdit(first.messageId), true);
      assert.equal(call.pendingTranscript.value.messageId, first.messageId);
      assert.deepEqual(call.pendingTranscript.value.focus, { projectSlug: "example", sessionId: "session-a" });
      assert.equal(call.microphoneMuted.value, true);
      assert.equal(view.media[0].stops, 0, "editing A pauses capture without destroying B");
      assert.equal(view.voice.activeListenTurnId.value, turnId);
      assert.equal(view.voice.partialTranscript.value, newer.text);
      const frames = socket.sent.filter(frame => typeof frame !== "string").length;
      view.worklets[0].emit(new Float32Array([0.4, -0.4]));
      assert.equal(socket.sent.filter(frame => typeof frame !== "string").length, frames, "Edit's pause owns only capture PCM");
      call.editTranscript("Edited first words", first.messageId);
      if (recovery === "edit with explicit mute") {
        await call.toggleMicrophoneMuted();
        await call.toggleMicrophoneMuted();
        assert.equal(call.microphoneMuted.value, true);
      }
      await call.deliverTranscript();
    } else if (recovery === "retry") await call.deliverTranscript();
    else assert.equal(await call.takeTranscript(first.messageId), true);
    await flushVue();
    assert.equal(call.pendingTranscript.value, null);
    assert.equal(view.voice.partialTranscript.value, newer.text);
    assert.equal(view.emitted.filter(([name]) => name === "transcript").at(-1)[1].id, newer.id);
    if (recovery === "edit with explicit mute") {
      assert.equal(call.microphoneMuted.value, true, "A resolution cannot undo the person's later mute choice");
      assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 1);
      await call.toggleMicrophoneMuted();
      socket.receive({ type: "transcript.endpoint", turnId, text: newer.text, revision: 3 });
      await flushVue();
    } else assert.equal(call.microphoneMuted.value, false);
    assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 2);
    socket.receive({ type: "transcript.final", turnId, text: newer.text, revision: 3, continuous: true });
    socket.receive({ type: "transcript.reset", turnId, revision: 4 });
    await flushVue();
    const firstAttempts = deliveries.filter(delivery => delivery.messageId === first.messageId);
    assert.equal(firstAttempts.length, recovery === "discard" ? 1 : 2);
    if (recovery !== "discard") {
      assert.equal(firstAttempts[1].text, recovery.startsWith("edit") ? "Edited first words" : first.text);
      assert.deepEqual(firstAttempts[1].focus, first.focus);
    }
    assert.deepEqual(deliveries.filter(delivery => delivery.messageId === newer.id), [{ text: newer.text,
      messageId: newer.id, focus: { projectSlug: "newer-project", sessionId: "newer-session" } }]);
    assert.equal(controls(socket).filter(control => control.type === "listen.commit").length, 2);
    assert.equal(view.media[0].stops, 0);
    assert.equal(view.voice.activeSpeechTurnId.value, speechId);
    assert.equal(controls(socket).some(control => control.type === "cancel" && control.turnId === speechId), false);
  });
}
