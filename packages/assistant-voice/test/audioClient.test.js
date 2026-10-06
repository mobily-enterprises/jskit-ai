import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrophoneCapture, float32ToPcm16ArrayBuffer } from '../src/client/audioCapture.js';
import { createConversationNarrationTracker, latestConversationFinalNarrationEntry } from '../src/client/conversationNarration.js';
import { normalizeSpeechSegment, pcm16ArrayBufferToFloat32, visemeCueAtTime } from '../src/client/voicePlayback.js';
test("read-aloud ignores progress and narrates only the latest completed final answer", () => {
  const turns = [{
    assistant: { messageId: "answer-1", text: "Earlier answer." },
    commentary: [],
    turnId: "turn-1"
  }, {
    assistant: { messageId: "answer-2", text: "Finished." },
    commentary: [
      { messageId: "progress-1", role: "commentary", text: "I’m checking the current state." },
      { messageId: "progress-2", role: "commentary", text: "The focused checks pass." }
    ],
    thinking: [
      { messageId: "private-1", role: "thinking", text: "Hidden reasoning" }
    ],
    turnId: "turn-2"
  }];

  assert.deepEqual(latestConversationFinalNarrationEntry(turns), {
    key: "final:turn-2",
    kind: "final",
    text: "Finished."
  });
});

test("chattiness tracks streamed sentences once and never replays disabled or rewritten text", () => {
  const tracker = createConversationNarrationTracker();
  tracker.observe([]);
  const thought = { messageId: "thought", role: "thinking", text: "Checking" };
  const turns = [{ turnId: "work", messages: [thought] }];
  const options = { vocalizeThinking: true };
  assert.deepEqual(tracker.observe(turns, options), []);
  thought.text = "Checking the application. Still";
  assert.deepEqual(tracker.observe(turns, options), [{ kind: "thinking", text: "Checking the application." }]);
  assert.deepEqual(tracker.observe(turns, options), []);
  thought.text += " looking at the settings.";
  assert.deepEqual(tracker.observe(turns, options), [{ kind: "thinking", text: "Still looking at the settings." }]);
  thought.text += " This was received while muted.";
  assert.deepEqual(tracker.observe(turns, { ...options, enabled: false }), []);
  assert.deepEqual(tracker.observe(turns, options), []);
  thought.text = "A corrected version of the earlier thought.";
  assert.deepEqual(tracker.observe(turns, options), []);
  thought.text += " Here is a new sentence.";
  assert.deepEqual(tracker.observe(turns, options), [{ kind: "thinking", text: "Here is a new sentence." }]);
});

test("settled unpunctuated messages speak once and continue without repeating the title", () => {
  const tracker = createConversationNarrationTracker();
  tracker.observe([]);
  const thought = { messageId: "title", role: "thinking", text: "Handling authorization and failure messages" };
  const turns = [{ turnId: "work", messages: [thought] }];
  const options = { vocalizeThinking: true };
  assert.deepEqual(tracker.observe(turns, options), []);
  assert.deepEqual(tracker.observe(turns, { ...options, settled: true }), [
    { kind: "thinking", text: thought.text }
  ]);
  assert.deepEqual(tracker.observe(turns, options), []);
  assert.deepEqual(tracker.observe(turns, { ...options, settled: true }), []);
  thought.text += " across all requests.";
  assert.deepEqual(tracker.observe(turns, options), [
    { kind: "thinking", text: "across all requests." }
  ]);
});

test("chattiness options are independent and final answers supersede activity regardless of them", () => {
  const tracker = createConversationNarrationTracker();
  tracker.observe([]);
  const turns = [{ turnId: "work", messages: [
    { messageId: "t1", role: "thinking", text: "An internal summary." },
    { messageId: "c1", role: "commentary", text: "I am checking the settings." }
  ] }];
  assert.deepEqual(tracker.observe(turns, { vocalizeInterimTurns: true }), [
    { kind: "commentary", text: "I am checking the settings." }
  ]);
  assert.deepEqual(tracker.observe(turns, { vocalizeThinking: true, vocalizeInterimTurns: true }), []);
  turns[0].messages.push({ messageId: "t2", role: "thinking", text: "The result is ready." });
  turns[0].assistant = { text: "The final response." };
  assert.deepEqual(tracker.observe(turns, { includeFinals: true }), [
    { key: "final:work", kind: "final", text: "The final response." }
  ]);
  assert.deepEqual(tracker.observe(turns, { includeFinals: true }), []);
  tracker.reset();
  assert.deepEqual(tracker.observe(turns, { includeFinals: true, vocalizeThinking: true }), []);
});

test("long streaming thoughts keep narrating new sentences beyond the speech request limit", () => {
  const tracker = createConversationNarrationTracker();
  const thought = { messageId: "long-thought", role: "thinking", text: "An earlier sentence. ".repeat(300) };
  const turns = [{ turnId: "work", messages: [thought] }];
  tracker.observe(turns, { vocalizeThinking: true });
  thought.text += "This is the latest thought.";
  assert.deepEqual(tracker.observe(turns, { vocalizeThinking: true }), [
    { kind: "thinking", text: "This is the latest thought." }
  ]);
});

test("PCM playback conversion preserves signed 16-bit amplitude", () => {
  const pcm = new ArrayBuffer(6);
  const view = new DataView(pcm);
  view.setInt16(0, -32_768, true);
  view.setInt16(2, 0, true);
  view.setInt16(4, 16_384, true);
  assert.deepEqual([...pcm16ArrayBufferToFloat32(pcm)], [-1, 0, 0.5]);
  const captured = new DataView(float32ToPcm16ArrayBuffer(new Float32Array([-1, 0, 1])));
  assert.deepEqual([
    captured.getInt16(0, true),
    captured.getInt16(2, true),
    captured.getInt16(4, true)
  ], [-32_768, 0, 32_767]);
});

test("microphone capture uses native 16 kHz processing and flushes its final PCM before closing", async () => {
  const originalAudioWorkletNode = Object.getOwnPropertyDescriptor(globalThis, "AudioWorkletNode");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let contextOptions = null;
  let mediaConstraints = null;
  let trackStopped = false;
  let contextClosed = false;
  const pcmFrames = [];

  const connectedNode = () => ({
    connect() {},
    disconnect() {}
  });
  class CapturingAudioContext {
    constructor(options) {
      contextOptions = options;
      this.audioWorklet = { async addModule() {} };
      this.destination = {};
      this.sampleRate = options.sampleRate;
      this.state = "suspended";
    }

    async close() {
      contextClosed = true;
      this.state = "closed";
    }

    createGain() {
      return { ...connectedNode(), gain: { value: 1 } };
    }

    createMediaStreamSource() {
      return connectedNode();
    }

    async resume() {
      this.state = "running";
    }
  }
  class CapturingAudioWorkletNode {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: () => {
          globalThis.setTimeout(() => {
            this.port.onmessage?.({ data: new Float32Array([-1, 1]) });
            this.port.onmessage?.({ data: { type: "flushed" } });
          }, 5);
        }
      };
    }

    connect() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    value: CapturingAudioWorkletNode
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          mediaConstraints = constraints;
          return {
            getTracks() {
              return [{ stop: () => { trackStopped = true; } }];
            }
          };
        }
      }
    }
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: CapturingAudioContext }
  });

  try {
    const capture = await createMicrophoneCapture({ onPcm: (frame) => pcmFrames.push(frame) });
    const closing = capture.close();
    assert.equal(trackStopped, false);
    await closing;
  } finally {
    for (const [name, descriptor] of [
      ["AudioWorkletNode", originalAudioWorkletNode],
      ["navigator", originalNavigator],
      ["window", originalWindow]
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
  assert.deepEqual(contextOptions, { latencyHint: "interactive", sampleRate: 16_000 });
  assert.equal(mediaConstraints.audio.sampleRate.ideal, 16_000);
  assert.equal(new DataView(pcmFrames[0]).getInt16(0, true), -32_768);
  assert.equal(new DataView(pcmFrames[0]).getInt16(2, true), 32_767);
  assert.equal(trackStopped, true);
  assert.equal(contextClosed, true);
});

test("microphone setup failure releases its acquired media resources", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let contextClosed = false;
  let trackStopped = false;
  class FailingAudioContext {
    constructor() {
      this.sampleRate = 16_000;
      this.state = "suspended";
    }

    async close() {
      contextClosed = true;
      this.state = "closed";
    }

    async resume() {
      throw new Error("Audio context setup failed.");
    }
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks() {
              return [{ stop: () => { trackStopped = true; } }];
            }
          };
        }
      }
    }
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FailingAudioContext }
  });

  try {
    await assert.rejects(
      createMicrophoneCapture(),
      /Audio context setup failed/u
    );
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
  }
  assert.equal(trackStopped, true);
  assert.equal(contextClosed, true);
});

test("speech segment cues follow exact PCM duration and select the active mouth pose", () => {
  const segment = normalizeSpeechSegment({
    cues: [
      { atMs: 1_200, level: 4, pose: "not-a-pose" },
      { atMs: 100, level: 0.6, pose: "wide" },
      { atMs: 500, level: 0.8, pose: "round" }
    ],
    durationMs: 9_999,
    sampleCount: 1_000
  }, 1_000);
  assert.equal(segment.durationMs, 1_000);
  assert.deepEqual(segment.cues, [
    { atMs: 100, level: 0.6, pose: "wide" },
    { atMs: 500, level: 0.8, pose: "round" },
    { atMs: 1_000, level: 1, pose: "closed" }
  ]);
  segment.startedAt = 8;
  assert.equal(visemeCueAtTime([segment], 8.49)?.pose, "wide");
  assert.equal(visemeCueAtTime([segment], 8.5)?.pose, "round");
  assert.equal(visemeCueAtTime([segment], 9)?.pose, "closed");
  assert.equal(visemeCueAtTime([segment], 9.01), null);
});

test("voice waits for a streamed answer to finish before retiring its final narration key", () => {
  const tracker = createConversationNarrationTracker();
  const turn = { turnId: "000001", assistant: { text: "Partial answer", status: "inProgress" } };
  assert.equal(latestConversationFinalNarrationEntry([turn]), null);
  assert.deepEqual(tracker.observe([turn], { includeFinals: true }), []);
  turn.assistant = { text: "Complete answer" };
  assert.deepEqual(tracker.observe([turn], { includeFinals: true }), [
    { key: "final:000001", kind: "final", text: "Complete answer" }
  ]);
  assert.deepEqual(tracker.observe([turn], { includeFinals: true }), []);
});

test("voice narrates streamed commentary once after its canonical message is saved", () => {
  const tracker = createConversationNarrationTracker();
  const options = { vocalizeInterimTurns: true };
  tracker.observe([], options);
  const turn = { turnId: "000001", messages: [
    { messageId: "provider-item", role: "commentary", text: "Checking the code.", status: "inProgress" }
  ] };
  assert.deepEqual(tracker.observe([turn], options), []);
  turn.messages = [{ messageId: "saved-commentary", role: "commentary", text: "Checking the code." }];
  assert.deepEqual(tracker.observe([turn], options), [{ kind: "commentary", text: "Checking the code." }]);
  assert.deepEqual(tracker.observe([turn], options), []);
});
