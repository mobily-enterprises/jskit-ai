import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVoiceClientToken, readVoiceServiceCatalogue, voiceTokenSha256 } from "@jskit-ai/assistant-voice/server";
import { createStandInSpeechEngine } from "@jskit-ai/assistant-voice/stand-in";
import { runVoiceCli } from "../src/cli.js";

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function captureStdout(work) {
  const write = process.stdout.write;
  let written = "";
  process.stdout.write = chunk => { written += String(chunk); return true; };
  try { await work(); } finally { process.stdout.write = write; }
  return written;
}

test("the voice CLI has no signing key or token command", async () => {
  const help = await captureStdout(() => runVoiceCli(["help"]));
  assert.match(help, /serve --models-root PATH --credentials-file PATH \[--hotwords-file PATH\] \[--spellings-file PATH\]/u);
  assert.match(help, /--workers N/u);
  assert.doesNotMatch(help, /key-file|token|tenant/u);
  await assert.rejects(runVoiceCli(["token", "--key-file", "/run/key", "--tenant", "app"]), /Unknown voice command: token/u);
});

test("serve requires a credentials file before it loads an engine", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-cli-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const previous = process.env.JSKIT_VOICE_CREDENTIALS_FILE;
  delete process.env.JSKIT_VOICE_CREDENTIALS_FILE;
  t.after(() => { if (previous !== undefined) process.env.JSKIT_VOICE_CREDENTIALS_FILE = previous; });
  await assert.rejects(runVoiceCli(["serve", "--models-root", root], {
    createEngine: () => assert.fail("No engine loads without credentials.")
  }), /requires --credentials-file/u);
});

test("serve refuses a spellings file it cannot read as spellings, naming the file and line, before it loads an engine", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-cli-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const spellingsFile = path.join(root, "spellings.txt");
  await writeFile(spellingsFile, "vibe sixty four => Vibe64\nmerc = Merc\n");
  await assert.rejects(runVoiceCli(["serve", "--models-root", root, "--credentials-file", path.join(root, "credentials.json"), "--spellings-file", spellingsFile], {
    createEngine: () => assert.fail("No engine loads with a bad spellings file.")
  }), { name: "TypeError", message: `${spellingsFile}: Spellings line 2 must read "spoken phrase => Written form".` });
});

test("serve runs the real daemon on a host's engine, with its credentials file, hotwords, spellings and worker counts", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-cli-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const token = createVoiceClientToken();
  const credentialsFile = path.join(root, "credentials.json");
  await writeFile(credentialsFile, JSON.stringify({
    schema: "jskit.assistant-voice.credentials.v1",
    clients: { "lnk_test": { tokenSha256: [voiceTokenSha256(token)] } }
  }));
  const hotwordsFile = path.join(root, "hotwords.txt");
  await writeFile(hotwordsFile, "# Product words\nMercbot\n\nVIBE SIXTY FOUR :2\n");
  const spellingsFile = path.join(root, "spellings.txt");
  await writeFile(spellingsFile, "# Product spellings\nvibe sixty four => Vibe64\nmerc => Merc\nj s kit => J.S. Kit\n");
  const port = await freePort();
  let engineOptions;
  let engine;
  let service;
  const output = await captureStdout(async () => {
    service = await runVoiceCli([
      "serve", "--models-root", root, "--credentials-file", credentialsFile, "--hotwords-file", hotwordsFile, "--spellings-file", spellingsFile,
      "--port", String(port), "--workers", "3", "--synthesis-workers", "2"
    ], {
      createEngine: options => {
        engineOptions = options;
        engine = createStandInSpeechEngine({ ...options, recognizedText: "MERC BUILT VIBE SIXTY FOUR WITH J S KIT" });
        return engine;
      }
    });
  });
  t.after(() => service.close());
  assert.deepEqual(engineOptions.hotwords, ["Mercbot", "VIBE SIXTY FOUR :2"]);
  assert.deepEqual(engineOptions.spellings, { "vibe sixty four": "Vibe64", merc: "Merc", "j s kit": "J.S. Kit" });
  const listening = engine.createListeningSession();
  listening.acceptPcm(Buffer.alloc(320));
  assert.equal(listening.finish(), "Merc built Vibe64 with J.S. Kit", "the host's spellings write what is heard, its own winning over JSKIT's");
  assert.equal(engineOptions.recognitionWorkers, 3);
  assert.equal(engineOptions.synthesisWorkers, 2);
  assert.equal(engineOptions.modelsRoot, root);
  assert.match(output, new RegExp(`Assistant voice ready on 127\\.0\\.0\\.1:${port}`, "u"));
  const loaded = output.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } })
    .find(record => record?.type === "voice.credentials");
  assert.deepEqual(loaded.clientsAdded, ["lnk_test"], "the credentials load is logged on standard output");
  const health = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.ok(health.versions["@jskit-ai/assistant-voice/stand-in"], "health shows a stand-in engine runs");
  const catalogue = await readVoiceServiceCatalogue({ available: true, endpoint: `ws://127.0.0.1:${port}/v1/voice`, token });
  assert.deepEqual(catalogue.recognitionModels, [{ id: "stand-in", hotwords: 2, spellings: 43 }]);
  await service.close();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
});
