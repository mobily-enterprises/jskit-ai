import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  VOICE_INPUT_SAMPLE_RATE,
  speechTextFromAssistant,
  takeStreamingSpeech
} from "../src/shared/protocol.js";
import {
  createVoiceAccessToken
} from "../src/server/voiceAccessToken.js";
import {
  createBoundedSerialQueue,
  createVoiceDaemon
} from "../src/server/voiceDaemon.js";
import { readVoiceCatalogue } from "../src/server/voiceProxy.js";

const ACCESS_KEY = "0123456789abcdef0123456789abcdef";

test("voice choices require authorization and consume no audio connection", async t => {
  const engine = fakeSpeechEngine();
  engine.voices = [{ id: "kitten_bella", label: "Bella", language: "en", modelPath: "/private/model" }];
  engine.defaultVoice = "kitten_bella";
  engine.createListeningSession = () => assert.fail("Listing voices must not acquire recognition resources.");
  engine.synthesize = () => assert.fail("Listing voices must not generate speech.");
  const daemon = createVoiceDaemon({ engine, accessKey: ACCESS_KEY, port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const endpoint = `ws://127.0.0.1:${address.port}/v1/voice`;
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "voice-settings" });
  const catalogue = await readVoiceCatalogue({ available: true, endpoint, token });
  assert.deepEqual(catalogue, { voices: [{ id: "kitten_bella", label: "Bella", language: "en" }], defaultVoice: "kitten_bella" });
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`).then(response => response.json())).connections, 0);
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/voices`)).status, 401);
  await assert.rejects(readVoiceCatalogue({ available: true, endpoint, token: "wrong" }), { statusCode: 503 });
  await assert.rejects(readVoiceCatalogue({ available: false }), { statusCode: 503 });
});

function createSocketMessageCollector(socket) {
  const messages = [];
  const waiters = [];
  const settle = () => {
    for (const waiter of [...waiters]) {
      const index = messages.findIndex((entry) => waiter.predicate(entry.value, entry.isBinary));
      if (index < 0) {
        continue;
      }
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(messages.splice(index, 1)[0]);
    }
  };
  socket.on("message", (raw, isBinary) => {
    messages.push({
      isBinary,
      value: isBinary ? Buffer.from(raw) : JSON.parse(raw.toString())
    });
    settle();
  });
  return Object.freeze({
    async audio(sampleCount) {
      const frames = [];
      let bytes = 0;
      while (bytes < sampleCount * 2) {
        const frame = (await this.next((_value, binary) => binary)).value;
        frames.push(frame);
        bytes += frame.byteLength;
      }
      assert.equal(bytes, sampleCount * 2);
      return Buffer.concat(frames);
    },
    next(predicate, timeoutMs = 2_000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          reject,
          resolve,
          timeout: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error("Timed out waiting for voice socket message."));
          }, timeoutMs)
        };
        waiters.push(waiter);
        settle();
      });
    }
  });
}

function fakeSpeechEngine() {
  return {
    createListeningSession({ onPartial }) {
      let acceptedSamples = 0;
      return {
        acceptPcm(frame) {
          acceptedSamples += frame.byteLength / 2;
          onPartial("Hello");
        },
        cancel() {},
        finish() {
          return "Hello world";
        },
        get acceptedSamples() {
          return acceptedSamples;
        }
      };
    },
    sampleRate: 22_050,
    async synthesize(_text, { onAudio, signal }) {
      if (!signal.aborted) {
        onAudio(Buffer.from([1, 0, 2, 0]));
      }
      return { cancelled: signal.aborted, sampleRate: 22_050, samples: 2 };
    },
    async warmup() {}
  };
}

test("voice daemon streams tenant-authenticated transcription and speech", async (context) => {
  const daemon = createVoiceDaemon({
    accessKey: ACCESS_KEY,
    engine: fakeSpeechEngine(),
    host: "127.0.0.1",
    port: 0
  });
  const address = await daemon.start();
  context.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${token}` }
  });
  context.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);

  const ready = await messages.next((value) => value?.type === "voice.ready");
  assert.equal(ready.value.inputSampleRate, VOICE_INPUT_SAMPLE_RATE);

  socket.send(JSON.stringify({
    sampleRate: VOICE_INPUT_SAMPLE_RATE,
    turnId: "listen-1",
    type: "listen.start"
  }));
  await messages.next((value) => value?.type === "listen.started");
  socket.send(Buffer.from([0, 0, 1, 0]));
  assert.equal((await messages.next(
    (value) => value?.type === "transcript.partial"
  )).value.text, "Hello");
  socket.send(JSON.stringify({ turnId: "listen-1", type: "listen.stop" }));
  assert.equal((await messages.next(
    (value) => value?.type === "transcript.final"
  )).value.text, "Hello world");

  socket.send(JSON.stringify({ text: "A concise answer.", turnId: "speak-1", type: "speak.start" }));
  assert.equal((await messages.next(
    (value) => value?.type === "speech.start"
  )).value.sampleRate, 22_050);
  const segment = await messages.next((value) => value?.type === "speech.segment");
  assert.equal(segment.value.sampleCount, 2);
  assert.equal(segment.value.turnId, "speak-1");
  assert.ok(segment.value.cues.some((cue) => cue.pose === "open"));
  assert.deepEqual((await messages.next((_value, isBinary) => isBinary)).value, Buffer.from([1, 0, 2, 0]));
  await messages.next((value) => value?.type === "speech.end");

  socket.send(JSON.stringify({
    text: "First sentence. Then—continue.",
    turnId: "speak-pauses",
    type: "speak.start"
  }));
  await messages.next((value) => value?.type === "speech.start" && value.turnId === "speak-pauses");
  const sentenceSegment = await messages.next((value) => (
    value?.type === "speech.segment" && value.turnId === "speak-pauses"
  ));
  const sentenceAudio = await messages.audio(sentenceSegment.value.sampleCount);
  const dashSegment = await messages.next((value) => (
    value?.type === "speech.segment" && value.turnId === "speak-pauses"
  ));
  const dashAudio = await messages.audio(dashSegment.value.sampleCount);
  const finalSegment = await messages.next((value) => (
    value?.type === "speech.segment" && value.turnId === "speak-pauses"
  ));
  const finalAudio = await messages.audio(finalSegment.value.sampleCount);

  assert.deepEqual([
    sentenceSegment.value.segmentIndex,
    dashSegment.value.segmentIndex,
    finalSegment.value.segmentIndex
  ], [0, 1, 2]);
  assert.ok(sentenceSegment.value.sampleCount > dashSegment.value.sampleCount);
  assert.ok(dashSegment.value.sampleCount > finalSegment.value.sampleCount);
  for (const [metadata, audio] of [
    [sentenceSegment.value, sentenceAudio],
    [dashSegment.value, dashAudio],
    [finalSegment.value, finalAudio]
  ]) {
    assert.equal(audio.byteLength, metadata.sampleCount * 2);
    assert.deepEqual(audio.subarray(0, 4), Buffer.from([1, 0, 2, 0]));
  }
  assert.ok(sentenceAudio.subarray(4).every((byte) => byte === 0));
  assert.ok(dashAudio.subarray(4).every((byte) => byte === 0));
  assert.equal(finalAudio.byteLength, 4);
  await messages.next((value) => value?.type === "speech.end" && value.turnId === "speak-pauses");

  socket.send(JSON.stringify({
    text: speechTextFromAssistant("The session labels are:\n\n* Save source\n* Update target — currently selected\n* Alternative approach"),
    turnId: "speak-list",
    type: "speak.start"
  }));
  await messages.next((value) => value?.type === "speech.start" && value.turnId === "speak-list");
  for (const [index, pauseMs] of [650, 650, 140, 650, 0].entries()) {
    const metadata = (await messages.next((value) => value?.type === "speech.segment" && value.turnId === "speak-list")).value;
    const audio = await messages.audio(metadata.sampleCount);
    assert.equal(metadata.segmentIndex, index);
    assert.equal(metadata.sampleCount, 2 + Math.round(pauseMs * 22_050 / 1_000));
    assert.equal(audio.byteLength, metadata.sampleCount * 2);
    assert.deepEqual(audio.subarray(0, 4), Buffer.from([1, 0, 2, 0]));
    assert.ok(audio.subarray(4).every((byte) => byte === 0));
  }
  await messages.next((value) => value?.type === "speech.end" && value.turnId === "speak-list");

  const health = await fetch(`http://127.0.0.1:${address.port}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.connections, 1);
});

test("recording and speech retain independent lifecycles until explicitly cancelled", async (context) => {
  const engine = fakeSpeechEngine();
  let releaseSpeech;
  let speechSignal;
  engine.synthesize = async (_text, { onAudio, signal }) => {
    speechSignal = signal;
    await new Promise((resolve) => {
      releaseSpeech = resolve;
      signal.addEventListener("abort", resolve, { once: true });
    });
    if (!signal.aborted) onAudio(Buffer.from([1, 0, 2, 0]));
    return { cancelled: signal.aborted, sampleRate: 22_050, samples: 2 };
  };
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  context.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${token}` }
  });
  context.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  await messages.next((value) => value?.type === "voice.ready");

  socket.send(JSON.stringify({ type: "speak.start", turnId: "answer", text: "Keep speaking while I steer." }));
  await messages.next((value) => value?.type === "speech.start");
  socket.send(JSON.stringify({ type: "listen.start", turnId: "steering", sampleRate: VOICE_INPUT_SAMPLE_RATE }));
  await messages.next((value) => value?.type === "listen.started");
  assert.equal(speechSignal.aborted, false, "starting a recording must not cancel speech");
  socket.send(Buffer.from([0, 0, 1, 0]));
  await messages.next((value) => value?.type === "transcript.partial");
  socket.send(JSON.stringify({ type: "listen.stop", turnId: "steering" }));
  assert.equal((await messages.next((value) => value?.type === "transcript.final")).value.text, "Hello world");
  assert.equal(speechSignal.aborted, false, "submitting a recording must not cancel speech");

  socket.send(JSON.stringify({ type: "listen.start", turnId: "discarded", sampleRate: VOICE_INPUT_SAMPLE_RATE }));
  await messages.next((value) => value?.type === "listen.started");
  socket.send(JSON.stringify({ type: "cancel", turnId: "discarded" }));
  await messages.next((value) => value?.type === "cancelled" && value.turnId === "discarded");
  assert.equal(speechSignal.aborted, false, "discarding a recording must not cancel speech");
  releaseSpeech();
  await messages.next((value) => value?.type === "speech.segment" && value.turnId === "answer");
  assert.deepEqual((await messages.next((_value, binary) => binary)).value, Buffer.from([1, 0, 2, 0]));
  await messages.next((value) => value?.type === "speech.end" && value.turnId === "answer");

  socket.send(JSON.stringify({ type: "speak.start", turnId: "stopped-answer", text: "Stop only this answer." }));
  await messages.next((value) => value?.type === "speech.start");
  socket.send(JSON.stringify({ type: "listen.start", turnId: "retained-recording", sampleRate: VOICE_INPUT_SAMPLE_RATE }));
  await messages.next((value) => value?.type === "listen.started");
  assert.equal(speechSignal.aborted, false);
  socket.send(JSON.stringify({ type: "cancel", turnId: "stopped-answer" }));
  await messages.next((value) => value?.type === "cancelled" && value.turnId === "stopped-answer");
  assert.equal(speechSignal.aborted, true, "explicit Stop speaking must cancel speech");
  socket.send(Buffer.from([0, 0, 1, 0]));
  await messages.next((value) => value?.type === "transcript.partial" && value.turnId === "retained-recording");
  socket.send(JSON.stringify({ type: "listen.stop", turnId: "retained-recording" }));
  assert.equal((await messages.next((value) => value?.type === "transcript.final")).value.text, "Hello world");
});

test("voice daemon rejects unauthenticated metal connections", async (context) => {
  const daemon = createVoiceDaemon({
    accessKey: ACCESS_KEY,
    engine: fakeSpeechEngine(),
    host: "127.0.0.1",
    port: 0
  });
  const address = await daemon.start();
  context.after(() => daemon.close());
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`);
  const statusCode = await new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    socket.once("error", reject);
  });
  assert.equal(statusCode, 401);
});

test("voice daemon closes an idle connection without reporting a command error", async (context) => {
  const daemon = createVoiceDaemon({
    accessKey: ACCESS_KEY,
    engine: fakeSpeechEngine(),
    host: "127.0.0.1",
    idleTimeoutMs: 80,
    port: 0
  });
  const address = await daemon.start();
  context.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const controls = [];
  socket.on("message", (raw, isBinary) => {
    if (!isBinary) {
      controls.push(JSON.parse(raw.toString()));
    }
  });
  const closed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for idle voice close.")), 2_000);
    socket.once("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
    socket.once("error", reject);
  });
  const messages = createSocketMessageCollector(socket);
  await messages.next((value) => value?.type === "voice.ready");

  assert.deepEqual(await closed, {
    code: 1000,
    reason: "Voice connection idle"
  });
  assert.equal(controls.some((message) => message.type === "error"), false);
});

test("outgoing speech activity keeps its voice connection alive", async (context) => {
  const engine = fakeSpeechEngine();
  engine.synthesize = async (_text, { onAudio, signal }) => {
    let samples = 0;
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (signal.aborted) {
        break;
      }
      onAudio(Buffer.from([index + 1, 0]));
      samples += 1;
    }
    return { cancelled: signal.aborted, sampleRate: 22_050, samples };
  };
  const daemon = createVoiceDaemon({
    accessKey: ACCESS_KEY,
    engine,
    host: "127.0.0.1",
    idleTimeoutMs: 80,
    port: 0
  });
  const address = await daemon.start();
  context.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${token}` }
  });
  context.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  await messages.next((value) => value?.type === "voice.ready");

  socket.send(JSON.stringify({ text: "Keep speaking.", turnId: "speak-active", type: "speak.start" }));
  await messages.next((value) => value?.type === "speech.end");
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test("speech queue is bounded and remains serial", async () => {
  const queue = createBoundedSerialQueue({ maximumQueued: 1 });
  let releaseFirst;
  const order = [];
  const first = queue.run(async () => {
    order.push("first:start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    order.push("first:end");
  });
  const second = queue.run(async () => {
    order.push("second");
  });
  await assert.rejects(
    queue.run(async () => null),
    { code: "voice_busy" }
  );
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
  queue.close();
});


test("audio reaches the client before synthesis finishes; streamed text appends without restarting playback", async (t) => {
  const finishing = [];
  const generated = [];
  const engine = fakeSpeechEngine();
  engine.synthesize = async (text, { onAudio, signal }) => {
    generated.push(text);
    onAudio(Buffer.from([1, 0, 2, 0]));
    await new Promise(resolve => { finishing.push(resolve); signal.addEventListener("abort", resolve, { once: true }); });
    return { sampleRate: 22050, samples: 2 };
  };
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${createVoiceAccessToken({ key: ACCESS_KEY, tenant: "streaming" })}` }
  });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  await messages.next(value => value.type === "voice.ready");
  socket.send(JSON.stringify({ type: "speak.start", turnId: "reply", text: "First clause", stream: true }));
  await messages.next(value => value.type === "speech.start");
  assert.deepEqual((await messages.next((_value, binary) => binary)).value, Buffer.from([1, 0, 2, 0]));
  assert.equal(finishing.length, 1, "first audio arrived while the synthesis result was still pending");
  socket.send(JSON.stringify({ type: "speak.append", turnId: "reply", text: "the next clause" }));
  finishing[0]();
  await messages.next(value => value.type === "speech.chunk.end");
  await messages.next((_value, binary) => binary);
  assert.deepEqual(generated, ["First clause", "the next clause"]);
  socket.send(JSON.stringify({ type: "speak.end", turnId: "reply" }));
  finishing[1]();
  await messages.next(value => value.type === "speech.end");
});

test("continuous listening commits only a current endpoint, discards noise, and keeps the same capture open", async (t) => {
  const engine = fakeSpeechEngine();
  let callbacks;
  let text = "";
  let endpoint = true;
  let resets = 0;
  let sessions = 0;
  engine.createListeningSession = (options) => {
    callbacks = options;
    sessions += 1;
    assert.equal(options.continuous, true);
    return { acceptedSamples: 0, acceptPcm() {}, cancel() {}, isEndpoint: () => endpoint,
      reset() { resets += 1; const result = text; text = ""; return result; } };
  };
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${token}` } });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  const send = control => socket.send(JSON.stringify({ turnId: "live", ...control }));
  const next = type => messages.next(value => value?.type === type).then(result => result.value);
  await next("voice.ready");
  send({ type: "ping" }); await next("pong");
  send({ type: "listen.start", sampleRate: VOICE_INPUT_SAMPLE_RATE, continuous: true });
  await next("listen.started");
  text = "I meant A"; callbacks.onPartial(text); callbacks.onEndpoint(text);
  const first = await next("transcript.endpoint");
  text = "I meant A with sugar"; callbacks.onPartial(text);
  send({ type: "listen.commit", revision: first.revision });
  await next("transcript.stale");
  assert.equal(resets, 0);
  callbacks.onEndpoint(text);
  const current = await next("transcript.endpoint");
  endpoint = false;
  send({ type: "listen.commit", revision: current.revision });
  await next("transcript.stale");
  assert.equal(resets, 0, "resumed speech invalidates admission even before text changes");
  endpoint = true;
  send({ type: "listen.commit", revision: current.revision });
  const final = await next("transcript.final");
  assert.equal(final.text, "I meant A with sugar");
  assert.equal(final.continuous, true);
  await next("transcript.reset");
  send({ type: "listen.commit", revision: current.revision });
  await next("transcript.stale");
  assert.equal(resets, 1, "duplicate commits do not admit duplicate words");
  text = "uh huh"; callbacks.onPartial(text); callbacks.onEndpoint(text);
  const noise = await next("transcript.endpoint");
  send({ type: "listen.discard", revision: noise.revision });
  await next("transcript.reset");
  assert.equal(resets, 2);
  assert.equal(sessions, 1);
});

test("microphone bursts yield to controls and finish only after preceding audio", async (t) => {
  const engine = fakeSpeechEngine();
  const accepted = [];
  engine.createListeningSession = ({ onPartial }) => ({
    acceptedSamples: 0,
    acceptPcm(frame) { accepted.push(frame.readInt16LE(0)); onPartial(String(accepted.length)); },
    finish: () => accepted.join(","),
    cancel() {}
  });
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${token}` } });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  const send = control => socket.send(JSON.stringify({ turnId: "listen", ...control }));
  await messages.next(value => value.type === "voice.ready");
  send({ type: "listen.start", sampleRate: VOICE_INPUT_SAMPLE_RATE });
  await messages.next(value => value.type === "listen.started");
  for (let i = 1; i <= 20; i++) socket.send(Buffer.from([i, 0]));
  send({ type: "ping" });
  send({ type: "listen.stop" });
  await messages.next(value => value.type === "pong");
  assert.ok(accepted.length < 20, "control traffic must not wait for the entire recognition backlog");
  const final = await messages.next(value => value.type === "transcript.final");
  assert.equal(final.value.text, Array.from({ length: 20 }, (_, i) => i + 1).join(","));
});

test("queued resumed speech invalidates a commit and cancellation drops queued audio", async (t) => {
  const engine = fakeSpeechEngine();
  const accepted = [];
  let resets = 0;
  engine.createListeningSession = ({ onPartial, onEndpoint }) => ({
    acceptedSamples: 0,
    acceptPcm(frame) { const word = String(frame.readInt16LE(0)); accepted.push(word); onPartial(word); onEndpoint(word); },
    isEndpoint: () => true,
    reset() { resets++; return accepted.at(-1); },
    cancel() {}
  });
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${token}` } });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  const send = control => socket.send(JSON.stringify({ turnId: "listen", ...control }));
  await messages.next(value => value.type === "voice.ready");
  send({ type: "listen.start", sampleRate: VOICE_INPUT_SAMPLE_RATE, continuous: true });
  await messages.next(value => value.type === "listen.started");
  socket.send(Buffer.from([1, 0]));
  const first = await messages.next(value => value.type === "transcript.endpoint");
  socket.send(Buffer.from([2, 0]));
  send({ type: "listen.commit", revision: first.value.revision });
  await messages.next(value => value.type === "transcript.stale");
  assert.equal(resets, 0);
  assert.deepEqual(accepted, ["1", "2"]);
  for (let i = 3; i <= 20; i++) socket.send(Buffer.from([i, 0]));
  send({ type: "cancel" });
  await messages.next(value => value.type === "cancelled");
  const atCancellation = accepted.length;
  assert.ok(atCancellation < 20);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted.length, atCancellation, "cancelled queued input must never be decoded");
});

test("recognition overload rejects the recording instead of accepting clipped words", async (t) => {
  const engine = fakeSpeechEngine();
  let cancelled = false;
  let finalized = false;
  engine.createListeningSession = () => ({ acceptedSamples: 0, acceptPcm() {},
    finish() { finalized = true; return "clipped instruction"; }, cancel() { cancelled = true; } });
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const token = createVoiceAccessToken({ key: ACCESS_KEY, tenant: "tenant-a" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${token}` } });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  const send = control => socket.send(JSON.stringify({ turnId: "listen", ...control }));
  await messages.next(value => value.type === "voice.ready");
  send({ type: "listen.start", sampleRate: VOICE_INPUT_SAMPLE_RATE });
  await messages.next(value => value.type === "listen.started");
  // Tiny frames exercise the count bound without depending on TCP packet sizes.
  for (let i = 0; i < 140; i++) socket.send(Buffer.from([1, 0]));
  send({ type: "listen.stop" });
  const error = await messages.next(value => value.type === "error" && value.code === "voice_recognition_backpressure");
  assert.match(error.value.message, /review/);
  assert.equal(cancelled, true);
  assert.equal(finalized, false);
});

test("streaming list and paragraph breaks produce real PCM silence after synthesis", async (t) => {
  const generated = [];
  const engine = fakeSpeechEngine();
  const synthesize = engine.synthesize;
  engine.synthesize = (text, options) => { generated.push(text); return synthesize(text, options); };
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start();
  t.after(() => daemon.close());
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
    headers: { authorization: `Bearer ${createVoiceAccessToken({ key: ACCESS_KEY, tenant: "pauses" })}` }
  });
  t.after(() => socket.close());
  const messages = createSocketMessageCollector(socket);
  await messages.next(value => value.type === "voice.ready");
  const original = "Options:\n- Use my_project\n- Keep another_value\n\nNext paragraph.\nNew line.";
  const expected = [
    ["Options:", 650], ["Use my project", 650], ["Keep another value", 650],
    ["Next paragraph.", 350], ["New line.", 220]
  ];
  let buffer = original;
  for (const [index, [words, pauseMs]] of expected.entries()) {
    const chunk = takeStreamingSpeech(buffer, true, index ? 140 : 64);
    assert.ok(chunk);
    buffer = buffer.slice(chunk.consumed);
    socket.send(JSON.stringify({ type: index ? "speak.append" : "speak.start", turnId: "structured-answer",
      text: speechTextFromAssistant(chunk.text), ...(index ? {} : { stream: true }) }));
    const metadata = (await messages.next(value => value.type === "speech.segment" && value.turnId === "structured-answer")).value;
    const audio = await messages.audio(metadata.sampleCount);
    assert.equal(generated.at(-1), words, "the synthesizer gets readable words without list markers or underscores");
    assert.equal(metadata.sampleCount, 2 + Math.round(pauseMs * engine.sampleRate / 1000));
    assert.deepEqual(audio.subarray(0, 4), Buffer.from([1, 0, 2, 0]));
    assert.ok(audio.subarray(4).every(byte => byte === 0), "the pause is actual silence following the generated voice");
    await messages.next(value => value.type === "speech.chunk.end" && value.turnId === "structured-answer");
  }
  assert.equal(buffer, "");
  // A boundary arriving after the preceding text must not synthesize an empty
  // utterance or disappear when parsed as a separate append.
  socket.send(JSON.stringify({ type: "speak.append", turnId: "structured-answer", text: "\n\n" }));
  const boundary = (await messages.next(value => value.type === "speech.segment" && value.turnId === "structured-answer")).value;
  assert.equal(boundary.sampleCount, Math.round(0.65 * engine.sampleRate));
  assert.ok((await messages.audio(boundary.sampleCount)).every(byte => byte === 0));
  assert.equal(generated.length, expected.length);
  await messages.next(value => value.type === "speech.chunk.end" && value.turnId === "structured-answer");
  socket.send(JSON.stringify({ type: "speak.end", turnId: "structured-answer" }));
  await messages.next(value => value.type === "speech.end" && value.turnId === "structured-answer");
  // Session narration may queue paragraphs as separate completed utterances.
  socket.send(JSON.stringify({ type: "speak.start", turnId: "standalone-paragraph", text: "A paragraph.\n\n" }));
  const standalone = (await messages.next(value => value.type === "speech.segment" && value.turnId === "standalone-paragraph")).value;
  assert.equal(standalone.sampleCount, 2 + Math.round(650 * engine.sampleRate / 1000));
  const standaloneAudio = await messages.audio(standalone.sampleCount);
  assert.ok(standaloneAudio.subarray(4).every(byte => byte === 0));
  await messages.next(value => value.type === "speech.end" && value.turnId === "standalone-paragraph");
});

test("host app grants share their workspace connection limit and revocation cancels active audio", async t => {
  let cancelled = 0;
  const engine = fakeSpeechEngine();
  engine.createListeningSession = () => ({ acceptPcm() {}, finish() { return ""; }, cancel() { cancelled += 1; } });
  const daemon = createVoiceDaemon({ engine, host: "127.0.0.1", port: 0, maximumConnectionsPerTenant: 2,
    authorize: token => ({ tenant: token, parentTenant: token.startsWith("app-") ? "workspace" : undefined }) });
  const address = await daemon.start(); t.after(() => daemon.close());
  async function open(tenant) {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${tenant}` } });
    t.after(() => socket.terminate());
    const messages = createSocketMessageCollector(socket);
    await messages.next(value => value?.type === "voice.ready");
    return { socket, messages };
  }
  const first = await open("app-one");
  const second = await open("app-two");
  const refused = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: "Bearer workspace" } });
  refused.on("error", () => {}); t.after(() => refused.terminate());
  const status = await new Promise(resolve => refused.once("unexpected-response", (_request, response) => { resolve(response.statusCode); response.destroy(); refused.terminate(); }));
  assert.equal(status, 429);
  first.socket.send(JSON.stringify({ type: "listen.start", sampleRate: 16000, turnId: "recording" }));
  await first.messages.next(value => value?.type === "listen.started");
  const closed = new Promise(resolve => first.socket.once("close", code => resolve(code)));
  daemon.revokeTenant("app-one");
  assert.equal(cancelled, 1, "revocation cancels immediately, before the peer close handshake");
  assert.equal(await closed, 1008);
  assert.equal(second.socket.readyState, WebSocket.OPEN);
  const replacement = await open("workspace");
  daemon.revokeTenant("workspace");
  await second.messages.next(value => value?.code === "voice_access_revoked");
  await replacement.messages.next(value => value?.code === "voice_access_revoked");
});

test("voice selection is advertised, validated and retained for every streamed phrase", async t => {
  const selected = [];
  const engine = fakeSpeechEngine();
  engine.voices = [{ id: "male", label: "Male voice" }, { id: "female", label: "Female voice" }];
  engine.defaultVoice = "female";
  const synthesize = engine.synthesize;
  engine.synthesize = (text, options) => { selected.push(options.voiceId); return synthesize(text, options); };
  const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
  const address = await daemon.start(); t.after(() => daemon.close());
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, { headers: { authorization: `Bearer ${createVoiceAccessToken({ key: ACCESS_KEY, tenant: "voice-choice" })}` } });
  t.after(() => socket.terminate());
  const messages = createSocketMessageCollector(socket);
  const ready = (await messages.next(value => value?.type === "voice.ready")).value;
  assert.deepEqual(ready.voices, engine.voices);
  assert.equal(ready.defaultVoice, "female");
  socket.send(JSON.stringify({ type: "speak.start", text: "Hello.", voiceId: "unavailable", turnId: "bad" }));
  assert.equal((await messages.next(value => value?.type === "error")).value.code, "voice_selection_invalid");
  assert.deepEqual(selected, []);
  socket.send(JSON.stringify({ type: "speak.start", text: "First phrase.", stream: true, voiceId: "male", turnId: "one" }));
  await messages.next(value => value?.type === "speech.chunk.end");
  socket.send(JSON.stringify({ type: "speak.append", text: "Second phrase.", turnId: "one" }));
  socket.send(JSON.stringify({ type: "speak.end", turnId: "one" }));
  await messages.next(value => value?.type === "speech.end");
  assert.deepEqual(selected, ["male", "male"]);
  socket.send(JSON.stringify({ type: "speak.start", text: "Default voice.", turnId: "two" }));
  await messages.next(value => value?.type === "speech.end" && value.turnId === "two");
  assert.equal(selected.at(-1), "female");
});

test("only acquired native segments advertise a bounded synthesis allowance; voice catalogues stay unchanged", async t => {
  for (const budget of [120000, undefined, 120001, "120000"]) await t.test(`engine budget ${budget}`, async child => {
    const engine = fakeSpeechEngine();
    engine.synthesisTimeoutMs = budget;
    engine.voices = [{ id: "test", label: "Test" }];
    engine.defaultVoice = "test";
    const daemon = createVoiceDaemon({ accessKey: ACCESS_KEY, engine, host: "127.0.0.1", port: 0 });
    const address = await daemon.start();
    child.after(() => daemon.close());
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/voice`, {
      headers: { authorization: `Bearer ${createVoiceAccessToken({ key: ACCESS_KEY, tenant: "native-budget" })}` }
    });
    child.after(() => socket.close());
    const messages = createSocketMessageCollector(socket);
    const ready = (await messages.next(value => value.type === "voice.ready")).value;
    assert.deepEqual(ready.voices, engine.voices);
    assert.equal(Object.hasOwn(ready, "synthesisTimeoutMs"), false);
    socket.send(JSON.stringify({ type: "speak.start", turnId: "native-budget", text: "A bounded native phrase." }));
    const segment = (await messages.next(value => value.type === "speech.segment.start")).value;
    assert.equal(segment.turnId, "native-budget");
    assert.equal(segment.segmentIndex, 0);
    assert.equal(Object.hasOwn(segment, "synthesisTimeoutMs"), budget === 120000);
    if (budget === 120000) assert.equal(segment.synthesisTimeoutMs, 120000);
    await messages.next(value => value.type === "speech.end");
  });
});
