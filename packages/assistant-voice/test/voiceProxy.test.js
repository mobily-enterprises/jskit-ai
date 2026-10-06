import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { registerVoiceProxyRoute } from '../src/server/voiceProxy.js';
import { VOICE_INPUT_SAMPLE_RATE, VOICE_MAX_AUDIO_FRAME_BYTES } from '../src/shared/protocol.js';
for (const state of ["connecting", "open"]) {
  for (const bytes of [0, 3]) {
    test(`voice proxy rejects ${bytes === 0 ? "empty" : "odd-length"} PCM while upstream is ${state}`, async (t) => {
      const view = await createVoiceProxyFixture(t);
      if (state === "open") view.metal.open();
      view.browser.emit("message", Buffer.alloc(bytes), true);
      const immediateErrors = view.browser.sent.map(({ frame }) => JSON.parse(frame.toString()));
      assert.deepEqual(immediateErrors.map(({ type, code }) => ({ type, code })), [
        { type: "error", code: "voice_audio_frame_invalid" }
      ], "the proxy must reject invalid PCM before any upstream admission can occur");
      assert.deepEqual(view.metal.sent, [], "invalid PCM must not be forwarded");
      assert.equal(view.browser.readyState, 1);
      assert.equal(view.metal.readyState, state === "connecting" ? 0 : 1);
      assert.deepEqual(view.browser.closes, []);
      assert.deepEqual(view.metal.closes, []);

      const validPcm = Buffer.from([1, 0, 2, 0]);
      view.browser.emit("message", validPcm, true);
      if (state === "connecting") {
        assert.deepEqual(view.metal.sent, [], "valid PCM waits for the same upstream connection to open");
        view.metal.open();
      }
      assert.deepEqual(view.metal.sent, [{ frame: validPcm, isBinary: true }],
        "only subsequent valid PCM may forward, including after the pending queue drains");
      assert.equal(view.metals.length, 1, "rejection must not require a replacement connection");
    });
  }
}

test("voice proxy preserves queued control and PCM order and forwards live replies", async (t) => {
  const view = await createVoiceProxyFixture(t);
  const start = Buffer.from(JSON.stringify({
    sampleRate: VOICE_INPUT_SAMPLE_RATE,
    turnId: "listen-1",
    type: "listen.start"
  }));
  const pcm = Buffer.from([0, 0, 1, 0]);
  const stop = Buffer.from(JSON.stringify({ turnId: "listen-1", type: "listen.stop" }));
  view.browser.emit("message", start, false);
  view.browser.emit("message", pcm, true);
  view.browser.emit("message", stop, false);
  assert.deepEqual(view.metal.sent, []);
  assert.deepEqual(view.browser.sent, []);

  view.metal.open();
  assert.deepEqual(view.metal.sent, [
    { frame: start, isBinary: false },
    { frame: pcm, isBinary: true },
    { frame: stop, isBinary: false }
  ]);
  view.browser.emit("message", pcm, true);
  assert.deepEqual(view.metal.sent.at(-1), { frame: pcm, isBinary: true });

  const reply = Buffer.from(JSON.stringify({ type: "transcript.final", turnId: "listen-1", text: "Hello" }));
  view.metal.emit("message", reply, false);
  view.metal.emit("message", pcm, true);
  assert.deepEqual(view.browser.sent, [
    { frame: reply, isBinary: false },
    { frame: pcm, isBinary: true }
  ]);
});

test("voice proxy keeps the connecting queue bounded without dropping already accepted PCM", async (t) => {
  const view = await createVoiceProxyFixture(t);
  view.browser.emit("message", Buffer.alloc(VOICE_MAX_AUDIO_FRAME_BYTES, 1), true);
  view.browser.emit("message", Buffer.alloc(VOICE_MAX_AUDIO_FRAME_BYTES, 2), true);
  view.browser.emit("message", Buffer.from([3, 0]), true);
  assert.deepEqual(view.metal.sent, []);
  assert.deepEqual(view.browser.sent.map(({ frame }) => JSON.parse(frame.toString()).code), ["voice_connecting"]);

  view.metal.open();
  assert.deepEqual(view.metal.sent.map(({ frame }) => frame.byteLength), [
    VOICE_MAX_AUDIO_FRAME_BYTES, VOICE_MAX_AUDIO_FRAME_BYTES
  ]);
  assert.deepEqual(view.metal.sent.map(({ frame }) => frame[0]), [1, 2]);
  view.browser.emit("message", Buffer.from([4, 0]), true);
  assert.deepEqual(view.metal.sent.at(-1), { frame: Buffer.from([4, 0]), isBinary: true });
  assert.equal(view.browser.readyState, 1);
});

test("voice proxy closes both peers for oversized PCM", async (t) => {
  const view = await createVoiceProxyFixture(t);
  view.browser.emit("message", Buffer.alloc(VOICE_MAX_AUDIO_FRAME_BYTES + 2), true);
  assert.deepEqual(view.metal.sent, []);
  assert.deepEqual(view.browser.sent.map(({ frame }) => JSON.parse(frame.toString()).code), ["voice_frame_too_large"]);
  assert.deepEqual(view.browser.closes.map(({ code }) => code), [1009]);
  assert.deepEqual(view.metal.closes.map(({ code }) => code), [1009]);
});

test("voice proxy cannot open an upstream connection after browser closure during inspection", async (t) => {
  const view = await createVoiceProxyFixture(t, { holdInspection: true });
  view.browser.close(1000, "Browser left");
  view.inspection.resolve({ ok: true, sessionId: "session-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(view.metals, []);
  assert.equal(view.browser.listenerCount("message"), 0);
});

test("global Colleague voice authorizes without a project or session and keeps the bounded proxy", async (t) => {
  const view = await createVoiceProxyFixture(t, { globalVoice: true, holdInspection: true });
  assert.equal(view.metals.length, 0, "no upstream connection before fresh authorization");
  view.inspection.resolve();
  await new Promise(setImmediate);
  const metal = view.metals[0];
  metal.open();
  const start = Buffer.from(JSON.stringify({ type: "speak.start", turnId: "global", text: "Hello." }));
  view.browser.emit("message", start, false);
  assert.deepEqual(metal.sent, [{ frame: start, isBinary: false }]);
  view.browser.emit("message", Buffer.alloc(3), true);
  assert.equal(metal.sent.length, 1);
  assert.equal(JSON.parse(view.browser.sent.at(-1).frame).code, "voice_audio_frame_invalid");
  view.browser.close(1000, "Signed out");
  assert.equal(metal.readyState, 3);
});

test("global Colleague voice refuses an authorization failure before creating an upstream", async (t) => {
  const view = await createVoiceProxyFixture(t, { globalVoice: true, holdInspection: true });
  view.inspection.reject(Object.assign(new Error("Access was revoked."), { code: "voice_auth_required" }));
  await new Promise(setImmediate);
  assert.equal(view.metals.length, 0);
  assert.equal(view.browser.readyState, 3);
  assert.equal(JSON.parse(view.browser.sent.at(-1).frame).code, "voice_auth_required");
});

async function createVoiceProxyFixture(t, { holdInspection = false, globalVoice = false } = {}) {
  const metals = [];
  const inspection = Promise.withResolvers();
  const inspectionStarted = Promise.withResolvers();
  let routeHandler;
  class ControlledSocket extends EventEmitter {
    constructor(endpoint, options) {
      super();
      this.readyState = endpoint ? 0 : 1;
      this.sent = [];
      this.closes = [];
      if (endpoint) {
        assert.equal(endpoint, "ws://voice.test/v1/voice");
        assert.equal(options.headers.authorization, "Bearer fixture-private-token");
        assert.equal(options.perMessageDeflate, false);
        metals.push(this);
      }
    }
    open() {
      assert.equal(this.readyState, 0);
      this.readyState = 1;
      this.emit("open");
    }
    send(frame, options = {}) {
      assert.equal(this.readyState, 1);
      this.sent.push({ frame: Buffer.from(frame), isBinary: options.binary === true });
    }
    close(code, reason) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.closes.push({ code, reason });
      this.emit("close", code, Buffer.from(reason || ""));
    }
  }
  const browser = new ControlledSocket();
  t.after(async () => {
    browser.close(1000, "Fixture cleanup");
    inspection.resolve({ ok: true, sessionId: "session-1" });
    await new Promise((resolve) => setImmediate(resolve));
    for (const metal of metals) metal.close(1000, "Fixture cleanup");
    browser.removeAllListeners();
    for (const metal of metals) metal.removeAllListeners();
  });
  registerVoiceProxyRoute({
    get(route, options, handler) {
      assert.equal(route, globalVoice ? "/api/global/voice" : "/api/conversations/:id/voice");
      assert.equal(options.websocket, true);
      routeHandler = handler;
    }
  }, {
    route: globalVoice ? "/api/global/voice" : "/api/conversations/:id/voice",
    authorize(request) {
      assert.equal(request.identity, "owner");
      inspectionStarted.resolve();
      return inspection.promise;
    },
    proxyConfig: { available: true, endpoint: "ws://voice.test/v1/voice", token: "fixture-private-token" },
    WebSocketCtor: ControlledSocket
  });
  routeHandler(browser, {
    ...(globalVoice ? {} : { params: { sessionId: "session-1", slug: "voice-project" } }),
    identity: "owner"
  });
  await inspectionStarted.promise;
  if (!holdInspection) {
    inspection.resolve({ ok: true, sessionId: "session-1" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(metals.length, 1);
  }
  return { browser, metal: metals[0], metals, inspection };
}
