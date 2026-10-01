import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { readFile } from "node:fs/promises";
import { createAiClient } from "@jskit-ai/assistant-core/server";
import { createConversationTranscript, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { registerVoiceProxyRoute, resolveVoiceProxyConfig } from "@jskit-ai/assistant-voice/server";

// Local single-user example. Hosted applications supply their own authenticated
// principal and conversation authorization through these same handlers.
const app = Fastify({ bodyLimit: 16384 });
await app.register(websocket);
const allowedOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5176";
function authorize(request) {
  if (request.headers.origin !== allowedOrigin) throw Object.assign(new Error("Open this example on its configured origin."), { statusCode: 403 });
}
app.addHook("preHandler", async request => { if (request.method !== "GET") authorize(request); });
const transcript = createConversationTranscript({ storage: createMemoryConversationStorage() });
const conversations = new Map(["planning", "notes"].map(id => [id, { id, label: id === "planning" ? "Planning" : "Notes", active: null, streamingReply: null, error: "" }]));
const client = process.env.AI_API_KEY_FILE ? createAiClient({
  provider: process.env.AI_PROVIDER || "deepseek", model: process.env.AI_MODEL || "deepseek-chat",
  baseUrl: process.env.AI_BASE_URL || "", apiKey: (await readFile(process.env.AI_API_KEY_FILE, "utf8")).trim()
}) : null;
function conversation(request) {
  const value = conversations.get(request.params.id);
  if (!value) throw Object.assign(new Error("Conversation not found."), { statusCode: 404 });
  return value;
}
async function state(value) {
  const turns = await transcript.readConversationLog(value.id);
  return { id: value.id, label: value.label, error: value.error, status: value.active ? "working" : "ready", streamingReply: value.streamingReply,
    messages: turns.flatMap(turn => [
      turn.user && { ...turn.user, id: turn.user.messageId || `${turn.turnId}:user` },
      turn.assistant && { ...turn.assistant, id: `${turn.turnId}:assistant` }
    ].filter(Boolean)) };
}
app.get("/api/conversations", async () => ({ provider: client ? `${client.provider} · ${client.defaultModel}` : "Configure AI_API_KEY_FILE to send messages", conversations: await Promise.all([...conversations.values()].map(state)) }));
app.post("/api/conversations/:id/messages", async request => {
  const value = conversation(request); const { text, messageId } = request.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > 8000 || typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(messageId)) throw Object.assign(new Error("A bounded message and stable ID are required."), { statusCode: 400 });
  const history = await transcript.readConversationLog(value.id);
  if (history.some(turn => turn.user?.messageId === messageId)) return { ok: true };
  if (!client) throw Object.assign(new Error("Configure the example's AI account first."), { statusCode: 503 });
  if (value.active) throw Object.assign(new Error("Wait for this answer or stop its work first."), { statusCode: 409 });
  const controller = new AbortController(); value.active = controller; value.error = "";
  let turn;
  try { turn = await transcript.writeConversationUserMessage(value.id, { text, messageId }); }
  catch (error) { value.active = null; throw error; }
  if (turn) void reply(value, turn, controller);
  else value.active = null;
  return { ok: true };
});
async function reply(value, turn, controller) {
  let answer = "";
  try {
    const history = await transcript.readConversationLog(value.id);
    const stream = await client.createChatCompletionStream({ signal: controller.signal, messages: [
      { role: "system", content: `You are the assistant for ${value.label}. Answer briefly in plain language.` },
      ...history.flatMap(entry => [entry.user, entry.assistant].filter(Boolean)).slice(-20).map(entry => ({ role: entry.role, content: entry.text }))
    ] });
    for await (const chunk of stream) {
      answer += chunk.choices?.[0]?.delta?.content || "";
      if (answer.length > 16000) throw new Error("Response limit reached.");
      value.streamingReply = { id: `${turn.turnId}:assistant`, role: "assistant", text: answer, status: "inProgress" };
    }
    if (!answer.trim()) throw new Error("The AI returned an empty answer.");
  } catch {
    value.error = controller.signal.aborted ? "Work stopped." : "The AI request failed. Check the configured account.";
    answer ||= value.error;
  } finally {
    try { await transcript.upsertConversationAssistantMessage(value.id, { turnId: turn.turnId, text: answer }); }
    catch { value.error = "The answer could not be saved."; }
    finally { value.streamingReply = null; value.active = null; }
  }
}
app.post("/api/conversations/:id/stop", async request => { conversation(request).active?.abort(); return { ok: true }; });
registerVoiceProxyRoute(app, { route: "/api/conversations/:id/voice", proxyConfig: resolveVoiceProxyConfig({
  endpoint: process.env.SPEECH_ENDPOINT, accessTokenFile: process.env.SPEECH_TOKEN_FILE
}), authorize(request) { authorize(request); conversation(request); } });
await app.listen({ host: "127.0.0.1", port: 3042 });
console.log("Voice example API ready on 127.0.0.1:3042");
