import { CUSTOM_AI_PLACEHOLDER_TOKEN } from "../../shared/nativeProviders.js";

// Loading a model on the person's own server can take this long on first use.
export const CUSTOM_ENDPOINT_CHECK_TIMEOUT_MS = 120_000;
const CONTEXT_READ_TIMEOUT_MS = 5_000;
const RESPONSE_LIMIT_BYTES = 256 * 1024;

const ENGINE_APIS = Object.freeze({
  codex: Object.freeze({
    path: "/responses",
    name: "Responses API",
    urlHint: "Codex needs an OpenAI Responses-compatible base URL, which usually ends in /v1.",
    body: (model) => ({ model, input: "Reply with OK.", max_output_tokens: 64, store: false }),
    usable: (result) => Boolean(result?.id) && Array.isArray(result.output) &&
      ["completed", "incomplete"].includes(result.status)
  }),
  claude: Object.freeze({
    path: "/v1/messages",
    name: "Anthropic Messages API",
    urlHint: "Claude Code needs an Anthropic-compatible base URL without /v1.",
    body: (model) => ({ model, max_tokens: 64, messages: [{ role: "user", content: "Reply with OK." }] }),
    usable: (result) => Boolean(result?.id) && result.type === "message" && Array.isArray(result.content)
  }),
  opencode: Object.freeze({
    path: "/chat/completions",
    name: "Chat Completions API",
    urlHint: "OpenCode needs an OpenAI-compatible base URL, which usually ends in /v1.",
    body: (model) => ({ model, max_tokens: 64, messages: [{ role: "user", content: "Reply with OK." }] }),
    usable: (result) => Boolean(result?.id) && Array.isArray(result.choices) && result.choices.length > 0
  })
});

function checkError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function readLimitedJson(response) {
  // readable-check: allow optional-call - platform object: a fetch Response body may be absent
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** A model server answers 404 both for a wrong path and for a model it does not have. */
function namesMissingModel(result, model) {
  const message = String(result?.error?.message ?? result?.error ?? result?.message ?? "").toLowerCase();
  return message.includes("model") && (message.includes("not found") || message.includes(model.toLowerCase()));
}

/**
 * One small request on the engine's own API with the entered model: the same
 * proof as a curated key check, for a server the person runs. Never exposes
 * the server's raw reply.
 * @param {{ engineId: "codex" | "claude" | "opencode", baseUrl: string, model: string, apiKey?: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number }} input
 */
export async function verifyCustomEndpoint({
  engineId, baseUrl, model, apiKey = "", fetchImpl = fetch, timeoutMs = CUSTOM_ENDPOINT_CHECK_TIMEOUT_MS
}) {
  const api = ENGINE_APIS[engineId];
  if (!api) throw new TypeError("Custom endpoints connect Codex, Claude Code or OpenCode.");
  const root = baseUrl.replace(/\/$/u, "");
  const token = apiKey || (engineId === "claude" ? CUSTOM_AI_PLACEHOLDER_TOKEN : "");
  let response;
  try {
    response = await fetchImpl(`${root}${api.path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(engineId === "claude" ? { "anthropic-version": "2023-06-01" } : {})
      },
      body: JSON.stringify(api.body(model))
    });
  } catch {
    throw checkError("custom_endpoint_unreachable",
      `Nothing answers at ${root}. Start your model server, then choose Check again.`);
  }
  const result = await readLimitedJson(response);
  if (response.status === 401 || response.status === 403) {
    throw checkError("custom_endpoint_key_rejected",
      `The server at ${root} rejected the key. Check the key, or leave it empty if the server needs none.`);
  }
  if (response.status === 404) {
    throw namesMissingModel(result, model)
      ? checkError("custom_endpoint_model_missing", `The server at ${root} has no model named ${model}.`)
      : checkError("custom_endpoint_path_missing", `${root}${api.path} was not found. ${api.urlHint}`);
  }
  if (!response.ok) {
    throw checkError("custom_endpoint_request_failed",
      `The server at ${root} could not complete a test request (HTTP ${response.status}).`);
  }
  if (!api.usable(result)) {
    throw checkError("custom_endpoint_answer_unusable",
      `The server at ${root} did not return a usable ${api.name} answer. ${api.urlHint}`);
  }
}

/**
 * The context Ollama really loaded the model with, read from `/api/ps` after a
 * check request loaded it. Ollama gives a 4,096-token context by default on
 * smaller GPUs and cuts longer prompts without an error. Null when the server
 * is not Ollama or no longer has the model loaded.
 * @param {{ baseUrl: string, model: string, apiKey?: string, fetchImpl?: typeof fetch }} input
 */
export async function readOllamaLoadedContext({ baseUrl, model, apiKey = "", fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "");
  let response;
  try {
    response = await fetchImpl(`${root}/api/ps`, {
      redirect: "error",
      signal: AbortSignal.timeout(CONTEXT_READ_TIMEOUT_MS),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });
  } catch {
    return null;
  }
  const result = response.ok ? await readLimitedJson(response) : null;
  if (!response.ok) {
    // readable-check: allow optional-call - platform object: a fetch Response body may be absent
    await response.body?.cancel?.();
  }
  if (!Array.isArray(result?.models)) return null;
  const names = new Set([model, model.includes(":") ? model : `${model}:latest`]);
  const loaded = result.models.find((entry) => names.has(entry?.name) || names.has(entry?.model));
  const contextLength = Number(loaded?.context_length);
  return Number.isSafeInteger(contextLength) && contextLength > 0 ? contextLength : null;
}

/**
 * Whether anything answers at a saved endpoint: one read of its model list,
 * which loads no model. Any HTTP answer counts, even a refusal; Health shows it
 * and never polls.
 * @param {{ engineId: "codex" | "claude" | "opencode", baseUrl: string, fetchImpl?: typeof fetch }} input
 */
export async function probeCustomEndpoint({ engineId, baseUrl, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/$/u, "");
  try {
    const response = await fetchImpl(engineId === "claude" ? `${root}/v1/models` : `${root}/models`, {
      redirect: "error",
      signal: AbortSignal.timeout(CONTEXT_READ_TIMEOUT_MS)
    });
    // readable-check: allow optional-call - platform object: a fetch Response body may be absent
    await response.body?.cancel?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Connect-time proof for one engine: the engine's API answers with the entered
 * model, and an Ollama server loaded it with at least the entered context.
 * @param {{ engineId: "codex" | "claude" | "opencode", baseUrl: string, model: string, contextWindow: number,
 *   apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} input
 */
export async function checkCustomEndpoint({ contextWindow, ...input }) {
  await verifyCustomEndpoint(input);
  const loaded = await readOllamaLoadedContext(input);
  if (loaded !== null && loaded < contextWindow) {
    throw checkError("custom_endpoint_context_too_small",
      `Ollama loaded ${input.model} with ${loaded.toLocaleString("en-US")} tokens of context, less than the ` +
      `${contextWindow.toLocaleString("en-US")} entered. It would cut prompts without an error. Restart it with ` +
      `OLLAMA_CONTEXT_LENGTH=${contextWindow}, then choose Check again.`);
  }
  return Object.freeze({
    ok: true,
    loadedContext: loaded
  });
}
