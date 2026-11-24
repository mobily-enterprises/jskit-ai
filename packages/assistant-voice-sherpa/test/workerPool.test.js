import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createVoiceClientToken, createVoiceDaemon, voiceTokenSha256 } from "@jskit-ai/assistant-voice/server";
import { createRecognitionProcess } from "../src/recognitionProcess.js";
import { createSherpaSpeechEngine } from "../src/sherpaSpeechEngine.js";
import { createSynthesisProcess } from "../src/synthesisProcess.js";

// The stand-in runtime holds each native decode for DECODE_MS, and the stand-in
// synthesis worker takes SYNTHESIS_MS per phrase, without models or CPU work.
const DECODE_MS = 150;
const SYNTHESIS_MS = 300;
const runtimeModule = new URL("./fixtures/standInSherpa.js", import.meta.url).href;
const synthesisWorkerUrl = new URL("./fixtures/synthesisWorker.js", import.meta.url);

function standInEngine(workers, { recognizer = {}, onRecognizer = () => null, spellings = {} } = {}) {
  return createSherpaSpeechEngine({
    spellings,
    recognitionWorkers: workers,
    synthesisWorkers: workers,
    configuration: {
      recognizer: { standInDecodeMs: DECODE_MS, ...recognizer },
      synthesizer: { standInSynthesisMs: SYNTHESIS_MS }
    },
    createRecognizer: async (config, options) => {
      const process = await createRecognitionProcess(config, { ...options, runtimeModule });
      onRecognizer(process);
      return process;
    },
    createSynthesizer: (config, options) => createSynthesisProcess(config, { ...options, workerUrl: synthesisWorkerUrl })
  });
}

async function startService(t, engine, clients) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-pool-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const credentialsFile = path.join(root, "credentials.json");
  await writeFile(credentialsFile, JSON.stringify({
    schema: "jskit.assistant-voice.credentials.v1",
    clients: Object.fromEntries(clients.map((token, index) => [`client-${index}`, { tokenSha256: [voiceTokenSha256(token)] }]))
  }));
  const daemon = createVoiceDaemon({ credentialsFile, engine, port: 0, accessLog: () => null });
  const { port } = await daemon.start();
  t.after(() => daemon.close());
  return `ws://127.0.0.1:${port}/v1/voice`;
}

function connect(t, url, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    t.after(() => socket.terminate());
    const waiters = [];
    socket.on("message", (raw, binary) => {
      if (binary) return;
      const message = JSON.parse(raw.toString());
      for (const waiter of [...waiters]) {
        if (waiter.type !== message.type) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
    const next = type => new Promise(done => waiters.push({ type, resolve: done }));
    next("voice.ready").then(() => resolve({ socket, next }));
    socket.once("error", reject);
  });
}

async function recognize({ socket, next }, turnId) {
  socket.send(JSON.stringify({ type: "listen.start", sampleRate: 16000, turnId }));
  await next("listen.started");
  const frame = Buffer.alloc(3200);
  for (let index = 0; index < frame.length; index += 2) frame.writeInt16LE(500, index);
  socket.send(frame);
  socket.send(JSON.stringify({ type: "listen.stop", turnId }));
  return (await next("transcript.final")).text;
}

async function speak({ socket, next }, turnId) {
  socket.send(JSON.stringify({ type: "speak.start", text: "Hello there.", turnId }));
  await next("speech.end");
}

async function timed(work) {
  const started = performance.now();
  const value = await work();
  return { ms: Math.round(performance.now() - started), value };
}

async function measure(t, workers) {
  const engine = await standInEngine(workers);
  t.after(() => engine.close());
  const tokens = [0, 1, 2, 3].map(() => createVoiceClientToken());
  const url = await startService(t, engine, tokens);
  const clients = await Promise.all(tokens.map(token => connect(t, url, token)));
  const recognitionOne = await timed(() => recognize(clients[0], "one"));
  const recognitionFour = await timed(() => Promise.all(clients.map((client, index) => recognize(client, `four-${index}`))));
  const synthesisOne = await timed(() => speak(clients[0], "speak-one"));
  const synthesisFour = await timed(() => Promise.all(clients.map((client, index) => speak(client, `speak-four-${index}`))));
  assert.equal(recognitionOne.value, "Hello world");
  assert.deepEqual(recognitionFour.value, ["Hello world", "Hello world", "Hello world", "Hello world"]);
  return {
    workers,
    recognitionOneMs: recognitionOne.ms,
    recognitionFourMs: recognitionFour.ms,
    synthesisOneMs: synthesisOne.ms,
    synthesisFourMs: synthesisFour.ms
  };
}

test("four clients' recordings and replies run at once on four workers, and one after another on one", { timeout: 60_000 }, async t => {
  const pooled = await measure(t, 4);
  t.diagnostic(JSON.stringify({ decodeMs: DECODE_MS, synthesisMs: SYNTHESIS_MS, ...pooled }));
  assert.ok(pooled.recognitionFourMs < 2 * pooled.recognitionOneMs,
    `four recordings took ${pooled.recognitionFourMs} ms, one took ${pooled.recognitionOneMs} ms`);
  assert.ok(pooled.synthesisFourMs < 2 * pooled.synthesisOneMs,
    `four replies took ${pooled.synthesisFourMs} ms, one took ${pooled.synthesisOneMs} ms`);
  const single = await measure(t, 1);
  t.diagnostic(JSON.stringify({ decodeMs: DECODE_MS, synthesisMs: SYNTHESIS_MS, ...single }));
  assert.ok(single.recognitionFourMs >= 3 * single.recognitionOneMs * 0.9, "one recognition worker runs recordings one after another");
  assert.ok(single.synthesisFourMs >= 3 * single.synthesisOneMs * 0.9, "one synthesis worker runs replies one after another");
});

test("a recognition worker that ends fails its recordings, and the next recording gets a replacement", { timeout: 30_000 }, async t => {
  const processes = [];
  const engine = await standInEngine(1, { recognizer: { standInDecodeMs: 0 }, onRecognizer: process => processes.push(process) });
  t.after(() => engine.close());
  const frame = Buffer.alloc(3200, 1);
  const first = engine.createListeningSession();
  assert.equal(await first.acceptPcm(frame), "Hello world");
  process.kill(processes[0].pid, "SIGKILL");
  for (let tries = 0; tries < 200 && processes[0].running; tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(processes[0].running, false);
  await assert.rejects(first.acceptPcm(frame), /unavailable/u);
  const second = engine.createListeningSession();
  assert.equal(await second.acceptPcm(frame), "Hello world");
  assert.equal(await second.finish(), "Hello world");
  assert.equal(processes.length, 2, "one replacement process");
  assert.equal(processes[1].running, true);
  await engine.close();
  assert.equal(processes[1].running, false);
  assert.throws(() => process.kill(processes[1].pid, 0), { code: "ESRCH" }, "closing the engine ends its recognition processes");
});

test("a recognition process writes what it hears with the host's spellings", { timeout: 30_000 }, async t => {
  const engine = await standInEngine(1, { recognizer: { standInDecodeMs: 0 }, spellings: { "hello world": "Hello, World!" } });
  t.after(() => engine.close());
  const listening = engine.createListeningSession();
  assert.equal(await listening.acceptPcm(Buffer.alloc(3200, 1)), "Hello, World!");
  assert.equal(await listening.finish(), "Hello, World!");
});

test("an engine whose recognizer cannot load refuses to start", { timeout: 30_000 }, async () => {
  await assert.rejects(standInEngine(2, { recognizer: { standInFailLoad: true } }), /refused its model/u);
});
