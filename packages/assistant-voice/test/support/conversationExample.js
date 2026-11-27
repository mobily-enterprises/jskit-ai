// The conversation example's server on a real port, with only its inference synthetic, for the example's interaction
// tests and its mounted starter's browser test.
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { createSocketIoClient } from "@jskit-ai/realtime/client/runtime";

const forbiddenImports = [];
registerHooks({ resolve(specifier, context, nextResolve) {
  if (["@jskit-ai/database-runtime", "knex"].some(name => specifier === name || specifier.startsWith(`${name}/`))) {
    forbiddenImports.push(specifier);
    throw new Error(`The file-backed example must not import ${specifier}.`);
  }
  return nextResolve(specifier, context);
} });
const { createExampleServer } = await import("../../examples/conversation/server.js");
// Import the shipped JavaScript clients without loading their Vue component
// barrels. These resolve from the installed packages in the packed proof too.
const { createAssistantApi } = await import(new URL("../../client/lib/assistantApi.js",
  import.meta.resolve("@jskit-ai/assistant-core/server/conversation")));
const { subscribeAssistantConversation } = await import(new URL("../client/support/subscribeAssistantConversation.js",
  import.meta.resolve("@jskit-ai/assistant-runtime/server")));

// The origin the example's own Vite server serves it on (`npm run dev`).
const exampleOrigin = "http://127.0.0.1:5176";
const inferenceUrl = "https://opencode.ai/zen/v1/chat/completions";

// Only inference is synthetic. The example, file store, connection catalogue,
// HTTP client/routes, Socket.IO transport and subscription reducer are real.
async function fixture(t, { port = 0, origin = exampleOrigin } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "voice-example-interaction-"));
  const storageDirectory = join(directory, "conversations");
  const integrationsPath = join(directory, "integrations.json");
  const changes = new EventEmitter();
  const notify = () => changes.emit("change");
  const requests = [], clients = [], releases = [];
  const realFetch = globalThis.fetch;
  let application, url;
  let socketConnections = 0;
  t.after(async () => {
    for (const release of releases) release();
    for (const client of clients) client.disconnect();
    try { await application?.app.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    assert.deepEqual(forbiddenImports, []);
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (address.href !== inferenceUrl) {
      assert.equal(address.origin, url, "Only the configured inference request is simulated; all application HTTP is real");
      return realFetch(input, init);
    }
    const body = JSON.parse(init.body);
    const replyId = `reply-${requests.length + 1}`;
    const encoder = new TextEncoder();
    let output;
    const stream = new ReadableStream({ start(controller) { output = controller; } });
    const push = (delta, finish_reason = null) => output.enqueue(encoder.encode(`data: ${JSON.stringify({
      id: replyId, object: "chat.completion.chunk", created: 1, model: "mimo-v2.5-free",
      choices: [{ index: 0, delta, finish_reason }]
    })}\n\n`));
    const aborted = () => {
      try { output.error(init.signal.reason); } catch {}
      notify();
    };
    init.signal.addEventListener("abort", aborted, { once: true });
    if (init.signal.aborted) aborted();
    requests.push({ body, signal: init.signal, text: value => push({ content: value }),
      finish() { push({}, "stop"); output.close(); } });
    notify();
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  await writeFile(integrationsPath, JSON.stringify({ schemaVersion: 1, registrations: {}, integrations: {
    assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" },
      settings: { model: "opencode/mimo-v2.5-free" } }
  } }));
  application = await createExampleServer({ env: {
    APP_ORIGIN: origin, ASSISTANT_ENGINE: "api", ASSISTANT_STORAGE_DIRECTORY: storageDirectory,
    ASSISTANT_WORKDIR: directory, ASSISTANT_INTEGRATIONS: integrationsPath
  } });
  url = await application.app.listen({ host: "127.0.0.1", port });
  application.app.server.on("upgrade", request => {
    if (request.url.startsWith("/socket.io/")) socketConnections++;
  });
  const http = createHttpClient({ csrf: { enabled: false }, readTimeoutMs: 5_000,
    hooks: { decorateHeaders({ headers }) { headers.origin = origin; } } });
  const api = createAssistantApi({ request: http.request,
    resolveBasePath: () => `${url}/api/assistant/home`, resolveSurfaceId: () => "home" });

  async function until(predicate, description) {
    const signal = AbortSignal.any([t.signal, AbortSignal.timeout(8_000)]);
    try { while (!predicate()) await once(changes, "change", { signal }); }
    catch (cause) { throw new Error(`Waiting for ${description} failed.`, { cause }); }
  }
  async function connect(socket) {
    if (!socket) {
      socket = createSocketIoClient({ url, options: {
        transports: ["websocket"], reconnection: false, autoConnect: false, extraHeaders: { Origin: origin }
      } });
      clients.push(socket);
    }
    const connected = once(socket, "connect", { signal: AbortSignal.any([t.signal, AbortSignal.timeout(5_000)]) });
    socket.connect();
    await connected;
    return socket;
  }
  function view(socket, id) {
    const states = [], events = [], errors = [];
    let initialReads = 0;
    const release = subscribeAssistantConversation({ socket, conversationId: id,
      targetSurfaceId: "home", hostSurfaceId: "home",
      read: () => api.readConversation(id, { signal: t.signal }),
      onState(state, { initial }) { states.push(state); if (initial) initialReads++; notify(); },
      onEvent(event) { events.push(event); notify(); },
      onError(error) { errors.push(error); notify(); }
    });
    releases.push(release);
    return { states, events, errors, get state() { return states.at(-1); }, get initialReads() { return initialReads; } };
  }
  async function stored() {
    return Promise.all((await readdir(storageDirectory)).filter(name => name.endsWith(".json"))
      .map(async name => JSON.parse(await readFile(join(storageDirectory, name), "utf8"))));
  }
  return { ...application, api, http, url, requests, connect, view, until, stored,
    socketConnections: () => socketConnections };
}


export { exampleOrigin, fixture };
