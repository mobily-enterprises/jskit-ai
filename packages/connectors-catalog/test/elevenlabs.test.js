import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { elevenlabsProvider } from "../src/server/elevenlabs.js";

test("ElevenLabs returns playable audio and creates a consented voice clone with verification status", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "elevenlabs-repair-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const context = { applicationId: "voice-app", subjectId: "workspace" }; const requests = [];
  let responseMode = "audio"; let status = 200; let deny = false; let fail = false;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { voice: { provider: "elevenlabs", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:ELEVENLABS_API_KEY" } } } },
    providers: [elevenlabsProvider], authorize: async owner => { if (deny) throw new Error("denied"); return owner; },
    resolveReference: async () => "fixture-voice-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init }); assert.equal(new Headers(init.headers).get("xi-api-key"), "fixture-voice-key");
      if (fail) throw new Error("unknown provider outcome");
      if (status !== 200) return Response.json({ error: "fixture" }, { status });
      if (new URL(url).pathname === "/v1/user") return Response.json({ user_id: "fixture-user" });
      if (new URL(url).pathname === "/v1/models") return Response.json([{ model_id: "fixture-model", can_do_text_to_speech: true }]);
      if (new URL(url).pathname === "/v1/voices/add") return Response.json({ voice_id: "cloned-voice", requires_verification: true });
      if (responseMode === "json") return Response.json({ error: "not audio" });
      return new Response(new Uint8Array(responseMode === "oversize" ? 16 * 1024 * 1024 + 1 : responseMode === "empty" ? 0 : [73, 68, 51, 255]), { headers: { "content-type": "audio/mpeg" } });
    }
  });
  const owner = { context, integrationId: "voice" }; await service.connectApiKey(owner);
  const invoke = (operation, input) => service.invoke({ ...owner, operation, input });
  assert.equal((await invoke("models.list"))[0].can_do_text_to_speech, true);
  const speech = { voiceId: "selected-voice", text: "Your appointment is ready.", model_id: "fixture-model" };
  const audio = await invoke("speech.create", speech);
  assert.equal(audio.contentType, "audio/mpeg"); assert.deepEqual([...Buffer.from(audio.bodyBase64, "base64")], [73, 68, 51, 255]);
  assert.equal(requests.at(-1).url.searchParams.get("output_format"), "mp3_44100_128");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { text: speech.text, model_id: speech.model_id });
  assert.equal(new Headers(requests.at(-1).init.headers).get("accept"), "audio/*");
  const clone = { name: "My voice", consentConfirmed: true, files: [{ name: "sample.mp3", contentType: "audio/mpeg", base64: "SUQz/w==" }] };
  assert.equal((await invoke("voices.clone", clone)).requires_verification, true);
  const form = requests.at(-1).init.body; assert(form instanceof FormData);
  assert.equal(form.get("name"), "My voice"); assert.equal(form.get("remove_background_noise"), "false"); assert.equal(form.has("consentConfirmed"), false);
  assert.deepEqual([...new Uint8Array(await form.get("files").arrayBuffer())], [73, 68, 51, 255]);
  const before = requests.length;
  for (const bad of [{ ...clone, consentConfirmed: false }, { ...clone, files: [] }, { ...clone, files: [{ ...clone.files[0], base64: "!!!!" }] }]) await assert.rejects(invoke("voices.clone", bad), { code: "connector_input_invalid" });
  for (const bad of [{ ...speech, voiceId: "../user" }, { ...speech, model_id: undefined }, { ...speech, text: "" }, { ...speech, voice_settings: { speed: 9 } }]) await assert.rejects(invoke("speech.create", bad), { code: "connector_input_invalid" });
  deny = true; await assert.rejects(invoke("speech.create", speech)); deny = false; assert.equal(requests.length, before);
  for (const mode of ["json", "empty", "oversize"]) { responseMode = mode; await assert.rejects(invoke("speech.create", speech), { code: mode === "oversize" ? "connector_response_too_large" : "connector_response_invalid" }); }
  responseMode = "audio";
  for (const [httpStatus, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) { status = httpStatus; await assert.rejects(invoke("speech.create", speech), { code }); }
  status = 200; fail = true; const failedBefore = requests.length; await assert.rejects(invoke("speech.create", speech)); assert.equal(requests.length, failedBefore + 1);
});
