import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAiConnectionResolver } from "@jskit-ai/connectors-catalog/server/ai";
import { createConversationRuntime, createFileConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { registerFastifyConversations } from "@jskit-ai/assistant-runtime/server";
import { registerVoiceProxyRoute, resolveVoiceProxyConfig } from "@jskit-ai/assistant-voice/server";
import { appConfig, conversations } from "./config.js";

export async function createExampleServer({ env = process.env } = {}) {
  const app = Fastify({ bodyLimit: 16384 });
  await app.register(websocket);
  const allowedOrigin = env.APP_ORIGIN || "http://127.0.0.1:5176";
  const context = Object.freeze({ applicationId: "talking-assistant-example", subjectId: "local-user" });
  const ids = new Set(conversations.map(value => value.id));
  function requireLocalRequest(request) {
    // Normal same-origin GETs may omit Origin. The shared socket readRequest()
    // reconstructs headers without an HTTP method, so it also requires Origin.
    // No hosted actor is made up for this local application.
    if (!request || ((request.method !== "GET" || request.headers?.origin) && request.headers?.origin !== allowedOrigin)) {
      throw Object.assign(new Error("Open this example on its configured origin."), { statusCode: 403 });
    }
  }
  function authorizedContext(actor) {
    if (actor === context) return true;
    if (actor?.applicationId !== context.applicationId || actor?.subjectId !== context.subjectId) return false;
    requireLocalRequest(actor.requestMeta?.request);
    return true;
  }
  const engine = env.ASSISTANT_ENGINE || "api";
  const integrationConfiguration = env.ASSISTANT_INTEGRATIONS
    ? JSON.parse(await readFile(resolve(env.ASSISTANT_INTEGRATIONS), "utf8"))
    : { schemaVersion: 1, registrations: {}, integrations: {} };
  const connections = createAiConnectionResolver({
    configuration: integrationConfiguration, authorize: actor => authorizedContext(actor) ? context : null
  });
  const runtime = createConversationRuntime({
    engine, connections, defaultIntegrationId: "assistant",
    host: { workdir: resolve(env.ASSISTANT_WORKDIR || ".") },
    limits: { maxInputCharacters: 8000, maxOutputCharacters: 16000 },
    storage: createFileConversationStorage({ directory: resolve(env.ASSISTANT_STORAGE_DIRECTORY || ".assistant/conversations") }),
    authorize: ({ context: actor, conversationId }) => authorizedContext(actor) &&
      (ids.has(conversationId) || (actor === context && conversationId === "headless"))
  });
  function configuration(label) {
    return {
      systemPrompt: `You are the assistant for ${label}. Answer briefly in plain language.`,
      integrationId: env.ASSISTANT_INTEGRATION_ID || (env.ASSISTANT_INTEGRATIONS ? "assistant" : undefined),
      model: env.ASSISTANT_NATIVE_MODEL || undefined,
      effort: env.ASSISTANT_NATIVE_EFFORT || undefined
    };
  }
  app.addHook("onClose", () => runtime.close());
  registerVoiceProxyRoute(app, { route: "/api/conversations/:id/voice", proxyConfig: resolveVoiceProxyConfig({
    endpoint: env.SPEECH_ENDPOINT, accessTokenFile: env.SPEECH_TOKEN_FILE
  }), authorize(request) {
    if (request.headers.origin !== allowedOrigin || !ids.has(request.params.id)) {
      throw Object.assign(new Error("This conversation is not available for voice."), { statusCode: 403 });
    }
  } });
  try {
    for (const value of conversations) await runtime.open({ id: value.id, context, configuration: configuration(value.label) });
    await registerFastifyConversations(app, {
      runtime, config: appConfig, env,
      authenticate(request) {
        requireLocalRequest(request);
        return context;
      },
      bootstrap: () => ({ example: { subjectId: context.subjectId, conversations,
        provider: ({ claude: "Claude Code", codex: "Codex", opencode: "OpenCode" })[engine] ||
          (env.ASSISTANT_INTEGRATIONS ? "Application AI connection" : "Configure ASSISTANT_INTEGRATIONS to send messages") } })
    });
  }
  catch (error) { await app.close(); throw error; }

  // A separately addressed server task uses the same runtime/store directly.
  // It has no browser route and is never automatically resumed or retried.
  async function runHeadless(text) {
    const conversation = await runtime.open({ id: "headless", context, configuration: configuration("Headless task") });
    await conversation.send({ messageId: randomUUID(), text });
    const state = await conversation.wait();
    if (state.error) throw new Error(state.error);
    return state.conversationLog.at(-1)?.assistant?.text || "";
  }
  return { app, runtime, runHeadless };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const headless = process.argv[2] === "--headless";
  const headlessText = process.argv.slice(3).join(" ").trim();
  if (headless && !headlessText) throw new Error("Pass a task after --headless.");
  const { app, runHeadless } = await createExampleServer();
  await app.listen({ host: "127.0.0.1", port: 3042 });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    app.close().catch(error => { app.log.error(error); process.exitCode = 1; });
  });
  console.log("Voice example API ready on 127.0.0.1:3042");
  if (headless) {
    runHeadless(headlessText).then(answer => console.log(`Headless task: ${answer}`))
      .catch(error => console.error(`Headless task failed: ${error.message}`));
  }
}
