import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createAiClient } from "@jskit-ai/assistant-core/server";
import { createConversationTranscript, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";

// This template is a single-user local application. A hosted app derives scope
// from authenticated actor/workspace/conversation ownership on every operation.
const scope = "example:local-user:conversation";
const storage = process.env.ASSISTANT_STORAGE_MODULE
  ? await (await import(pathToFileURL(resolve(process.env.ASSISTANT_STORAGE_MODULE)).href)).createStorage()
  : createMemoryConversationStorage();
const transcript = createConversationTranscript({ storage });
const configurationMode = process.env.ASSISTANT_CONFIGURATION_MODE || "editable";
if (!["hidden", "readonly", "editable"].includes(configurationMode)) throw new Error("Invalid configuration mode.");
const fixedConfiguration = Object.freeze({ tone: "concise" });
const ai = process.env.ASSISTANT_API_KEY ? createAiClient({
  provider: process.env.ASSISTANT_PROVIDER || "openai", apiKey: process.env.ASSISTANT_API_KEY,
  model: process.env.ASSISTANT_MODEL
}) : null;
let active = null;

function configurationFor(input) {
  if (configurationMode !== "editable") return fixedConfiguration;
  if (!input || Object.keys(input).some((key) => key !== "tone") || !["concise", "detailed"].includes(input.tone)) {
    throw new Error("Choose a supported answer style.");
  }
  return { tone: input.tone };
}

async function* reply(messages, configuration, signal) {
  if (ai) {
    const stream = await ai.createChatCompletionStream({ signal, messages: [
      { role: "system", content: `Answer in a ${configuration.tone} style.` }, ...messages
    ] });
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
    return;
  }
  const answer = `This is the **demo provider**. Your message was:\n\n${messages.at(-1).content}\n\nThe application supplies the provider and storage; JSKIT supplies the conversation UI and transcript behavior.`;
  for (const word of answer.match(/\S+\s*/g) || []) {
    await delay(35, undefined, { signal });
    yield word;
  }
}

async function body(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("Expected JSON.");
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 16_384) throw new Error("Message is too large.");
  }
  return JSON.parse(text);
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/conversation") {
      json(response, 200, { turns: await transcript.readConversationLog(scope), configurationMode,
        configuration: fixedConfiguration, providerLabel: ai ? `${ai.provider} · ${ai.defaultModel}` : "Demo provider · transient storage" });
      return;
    }
    if (request.method === "DELETE" && request.url === "/api/run") {
      active?.abort();
      json(response, 200, { stopped: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/messages") { json(response, 404, { error: "Not found." }); return; }
    const input = await body(request);
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 8000 ||
      typeof input.messageId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.messageId)) throw new Error("Invalid message.");
    const configuration = configurationFor(input.configuration);
    if (active) { json(response, 409, { error: "The assistant is already working." }); return; }
    const controller = new AbortController();
    active = controller;
    let turn;
    try { turn = await transcript.writeConversationUserMessage(scope, input); }
    catch (failure) { active = null; throw failure; }
    response.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const emit = (event) => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
    const disconnected = () => controller.abort();
    response.on("close", disconnected);
    let answer = "";
    try {
      // A duplicate request returns saved state; it never launches the provider again.
      if (turn) {
        const history = await transcript.readConversationLog(scope);
        emit({ type: "snapshot", turns: history.map((entry) => entry.turnId === turn.turnId ? { ...entry, pending: true } : entry) });
        const messages = history.flatMap((entry) => [entry.user, entry.assistant].filter(Boolean))
          .slice(-20).map((entry) => ({ role: entry.role, content: entry.text }));
        for await (const text of reply(messages, configuration, controller.signal)) {
          answer += text;
          if (answer.length > 32_000) throw new Error("Response limit reached.");
          emit({ type: "snapshot", turns: history.map((entry) => entry.turnId === turn.turnId
            ? { ...entry, pending: true, assistant: { role: "assistant", text: answer }, messages: [...entry.messages, { role: "assistant", text: answer }] }
            : entry) });
        }
        if (!answer.trim()) throw new Error("The provider returned an empty answer.");
      }
    } catch (failure) {
      emit({ type: "error", message: controller.signal.aborted ? "Stopped." : failure.message });
      answer ||= controller.signal.aborted ? "Stopped." : "The assistant could not complete this request.";
    }
    try {
      if (turn) await transcript.upsertConversationAssistantMessage(scope, { turnId: turn.turnId, text: answer });
      emit({ type: "snapshot", turns: await transcript.readConversationLog(scope) });
    } catch (failure) { emit({ type: "error", message: `Conversation could not be saved: ${failure.message}` }); }
    finally {
      response.off("close", disconnected);
      active = null;
      response.end();
    }
  } catch (failure) { json(response, 400, { error: failure.message }); }
}).listen(3041, "127.0.0.1", () => { console.log("Assistant example API: http://127.0.0.1:3041"); });
