import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { elevenlabsDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const voiceId = { type: "string", required: true, minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" };
const speechSchema = createSchema({
  voiceId, text: { type: "string", required: true, minLength: 1, maxLength: 5000 },
  model_id: { type: "string", required: true, minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" },
  output_format: { type: "string", enum: ["mp3_44100_128", "mp3_22050_32", "pcm_16000", "ulaw_8000"], defaultTo: "mp3_44100_128" },
  language_code: { type: "string", pattern: "^[a-z]{2}$" },
  voice_settings: { type: "object", schema: createSchema({
    stability: { type: "number", min: 0, max: 1 }, similarity_boost: { type: "number", min: 0, max: 1 },
    style: { type: "number", min: 0, max: 1 }, use_speaker_boost: { type: "boolean" }, speed: { type: "number", min: 0.7, max: 1.2 }
  }) }
});
const cloneSchema = createSchema({
  name: { type: "string", required: true, minLength: 1, maxLength: 100 },
  description: { type: "string", maxLength: 1000 },
  consentConfirmed: { type: "boolean", required: true, validator: value => value === true || "Confirm permission to clone this voice." },
  remove_background_noise: { type: "boolean", defaultTo: false },
  files: { type: "array", required: true, validator: value => (value.length >= 1 && value.length <= 5) || "Supply one to five audio samples.",
    items: { type: "object", schema: createSchema({
      name: { type: "string", required: true, minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_.-]+$" },
      contentType: { type: "string", required: true, enum: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/flac", "audio/ogg"] },
      base64: { type: "string", required: true, minLength: 4, maxLength: 12 * 1024 * 1024,
        validator: value => (/^[A-Za-z0-9+/]*={0,2}$/u.test(value) && Buffer.from(value, "base64").toString("base64") === value) || "Supply canonical base64 audio." }
    }) } }
});
const elevenlabsProvider = Object.freeze({
  ...elevenlabsDefinition, apiOrigins: ["https://api.elevenlabs.io"],
  apiKey: { headers: (key) => ({ "xi-api-key": key }) },
  checkOperation: "account.read",
  async exchange(url, options, { request, fetchImpl }) {
    if (!new URL(url).pathname.startsWith("/v1/text-to-speech/")) return request(url, options);
    const response = await fetchImpl(url, { ...options, body: JSON.stringify(options.body),
      headers: { ...options.headers, "Content-Type": "application/json", Accept: "audio/*" }, credentials: "omit", redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("ElevenLabs speech request failed."), { status: response.status }); }
    const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
      await response.body?.cancel(); throw new ConnectorError("connector_response_invalid", "ElevenLabs did not return audio.", { statusCode: 502 });
    }
    const reader = response.body?.getReader(); const chunks = []; let size = 0;
    if (reader) try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new ConnectorError("connector_response_too_large", "Use native streaming for audio above 16 MiB.", { statusCode: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new ConnectorError("connector_response_invalid", "ElevenLabs returned empty audio.", { statusCode: 502 });
    return { bodyBase64: Buffer.concat(chunks).toString("base64"), contentType, size };
  },
  operations: {
    "speech.create": { scopes: [], request(input) {
      const { voiceId, output_format, ...body } = validateSchemaPayload({ schema: speechSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${output_format}`, body };
    }, validateResult: result => typeof result?.bodyBase64 === "string" && result.size > 0 },
    "voices.clone": { scopes: [], request(input) {
      const { files, consentConfirmed, ...values } = validateSchemaPayload({ schema: cloneSchema, mode: "replace" }, input, { statusCode: 422 });
      const body = new FormData(); let total = 0;
      for (const file of files) {
        const bytes = Buffer.from(file.base64, "base64"); total += bytes.byteLength;
        if (total > 16 * 1024 * 1024) throw new ConnectorError("connector_input_invalid", "Audio samples must total at most 16 MiB.", { statusCode: 422 });
        body.append("files", new Blob([bytes], { type: file.contentType }), file.name);
      }
      for (const [key, value] of Object.entries(values)) body.append(key, String(value));
      return { method: "POST", url: "https://api.elevenlabs.io/v1/voices/add", body };
    }, validateResult: result => typeof result?.voice_id === "string" && typeof result.requires_verification === "boolean" },
    "models.list": jsonOperation("https://api.elevenlabs.io/v1/models", {}, Array.isArray),
    "account.read": jsonOperation("https://api.elevenlabs.io/v1/user", {}, (result) => typeof result?.user_id === "string"),
    "voices.list": jsonOperation("https://api.elevenlabs.io/v2/voices", {
      search: { type: "string", maxLength: 4096 },
      page_size: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      next_page_token: { type: "string", minLength: 1, maxLength: 4096 }
    }, (result) => Array.isArray(result?.voices) && typeof result.has_more === "boolean")
  }
});
export { elevenlabsProvider };
