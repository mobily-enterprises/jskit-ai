import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { createAiConnectionResolver } from "@jskit-ai/connectors-catalog/server/ai";
import { createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { upload, resolveFiles, contentFor, acceptFiles, removeFile, download } from "./attachments.js";
import { createAiConnectionClient } from "@jskit-ai/assistant-core/server";
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
// Set ASSISTANT_INTEGRATIONS to opt into real inference. The default stays offline.
const integrationConfiguration = process.env.ASSISTANT_INTEGRATIONS
  ? JSON.parse(await readFile(resolve(process.env.ASSISTANT_INTEGRATIONS), "utf8")) : null;
const context = Object.freeze({ applicationId: "conversation-example", subjectId: "local-user" });
const connections = integrationConfiguration ? createAiConnectionResolver({
  configuration: integrationConfiguration,
  authorize: actor => actor === context ? actor : null,
  resolveReference: createEnvironmentReferenceResolver(process.env)
}) : null;
const assistantIntegrationId = process.env.ASSISTANT_INTEGRATION_ID || "assistant";
const suggestionIntegrationId = process.env.ASSISTANT_SUGGESTION_INTEGRATION_ID || "suggestions";
const modelChoices = connections ? Object.entries(integrationConfiguration.integrations)
  .filter(([id, integration]) => integration.provider === "ai" && id !== suggestionIntegrationId)
  .map(([id, integration]) => ({ id, label: `${id} · ${integration.settings?.model || "Default AI model"}` })) : [];
async function clientFor(integrationId) {
  return connections ? createAiConnectionClient(await connections.resolve({ context, integrationId })) : null;
}
let active = null;

function configurationFor(input) {
  if (configurationMode !== "editable") return fixedConfiguration;
  if (!input || Object.keys(input).some((key) => key !== "tone") || !["concise", "detailed"].includes(input.tone)) {
    throw new Error("Choose a supported answer style.");
  }
  return { tone: input.tone };
}

async function* reply(messages, configuration, integrationId, signal) {
  const ai = await clientFor(integrationId);
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
  const answer = `This is the **demo provider**. Your message was:\n\n${Array.isArray(messages.at(-1).content) ? messages.at(-1).content.filter(part => part.type === "text").map(part => part.text).join("\n\n") : messages.at(-1).content}\n\nThe application supplies the provider and storage; JSKIT supplies the conversation UI and transcript behavior.`;
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
        configuration: fixedConfiguration, modelChoices, integrationId: assistantIntegrationId,
        providerLabel: connections ? "Application AI integration" : "Demo provider · transient storage" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/attachments") {
      json(response, 200, await upload(request)); return;
    }
    const attachmentPath = request.url?.match(/^\/api\/attachments\/([A-Za-z0-9-]+)$/);
    if (attachmentPath && request.method === "GET") { download(response, attachmentPath[1]); return; }
    if (attachmentPath && request.method === "DELETE") { removeFile(attachmentPath[1]); json(response, 200, { ok: true }); return; }
    if (request.method === "POST" && request.url === "/api/suggestions") {
      const input = await body(request);
      const controller = new AbortController();
      response.on("close", () => controller.abort());
      const suggestionAgent = await clientFor(suggestionIntegrationId);
      const history = await transcript.readConversationLog(scope);
      const result = suggestionAgent ? await suggestionAgent.createChatCompletion({
        signal: controller.signal,
        messages: [
          { role: "system", content: process.env.ASSISTANT_SUGGESTION_PROMPT || 'Suggest three useful next user messages. Return only a JSON array of {"label":"short label","prompt":"message"}. Do not execute tasks.' },
          { role: "user", content: JSON.stringify({ draft: String(input.draft || "").slice(0, 4000), turns: history.slice(-3) }) }
        ]
      }) : null;
      const suggestions = result ? JSON.parse(result.choices[0].message.content) : [
        { label: "Summarize", prompt: "Summarize our conversation so far." },
        { label: "Explain", prompt: "Explain your last answer in more detail." },
        { label: "Next steps", prompt: "What would be a useful next step?" }
      ];
      json(response, 200, suggestions); return;
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
    const integrationId = configurationMode === "editable" ? input.integrationId || assistantIntegrationId : assistantIntegrationId;
    if (connections && !modelChoices.some(choice => choice.id === integrationId)) throw new Error("Choose an allowed AI connection.");
    const files = resolveFiles(input.attachmentIds);
    input.attachments = files.map(file => file.receipt);
    if (active) { json(response, 409, { error: "The assistant is already working." }); return; }
    const controller = new AbortController();
    active = controller;
    let turn;
    try { turn = await transcript.writeConversationUserMessage(scope, input); acceptFiles(files); }
    catch (failure) { active = null; throw failure; }
    response.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const emit = (event) => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
    const disconnected = () => controller.abort();
    response.on("close", disconnected);
    let answer = "";
    try {
      // A duplicate request returns saved state; it never launches the provider again.
      emit({ type: "accepted" });
      if (turn) {
        const history = await transcript.readConversationLog(scope);
        emit({ type: "snapshot", turns: history.map((entry) => entry.turnId === turn.turnId ? { ...entry, pending: true } : entry) });
        const messages = history.flatMap((entry) => [entry.user, entry.assistant].filter(Boolean))
          .slice(-20).map((entry) => ({ role: entry.role, content: entry.attachments?.length
            ? [{ type: "text", text: entry.text }, ...resolveFiles(entry.attachments.map(file => file.attachmentId)).map(contentFor)] : entry.text }));
        for await (const text of reply(messages, configuration, integrationId, controller.signal)) {
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
