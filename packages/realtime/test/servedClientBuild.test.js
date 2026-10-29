import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { CLIENT_APP_CONFIG_GLOBAL_KEY, setClientAppConfig } from "../../kernel/client/appConfig.js";
import { RealtimeClientProvider } from "../src/client/RealtimeClientProvider.js";
import { RealtimeProvider } from "../src/server/RealtimeProvider.js";
import { announceServedClientBuild } from "../src/server/servedClientBuild.js";

const logger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
const FIRST_BUILD = "1111111111111111";
const SECOND_BUILD = "2222222222222222";

async function writeServedPage(appRoot, buildId) {
  await mkdir(path.join(appRoot, "dist"), { recursive: true });
  await writeFile(path.join(appRoot, "dist", "index.html"),
    `<!doctype html><html><head><meta name="jskit-client-build" content="${buildId}"></head></html>`);
}

// One server process: its own HTTP server and realtime runtime on a fixed port.
async function startServer({ appRoot, port = 0 }) {
  const http = createServer();
  const runtime = createCapabilityRuntime({ providers: [EventProvider, RealtimeProvider], inputs: {
    "runtime.app-root": appRoot, "runtime.config": {}, "runtime.env": {},
    "runtime.fastify": { server: http }, "runtime.logger": logger
  } });
  await runtime.start();
  http.listen(port, "127.0.0.1");
  await once(http, "listening");
  return {
    port: http.address().port,
    async stop() {
      await runtime.shutdown();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    }
  };
}

async function startClient(url) {
  let realtime = null;
  const probe = defineProvider({
    id: "test.realtime.client.probe",
    requires: { value: "client.realtime" },
    setup({ value }) {
      realtime = value;
      return {};
    }
  });
  setClientAppConfig({ realtimeClient: { url, options: {
    transports: ["websocket"], reconnectionDelay: 50, reconnectionDelayMax: 100, randomizationFactor: 0
  } } });
  const runtime = createCapabilityRuntime({ providers: [RealtimeClientProvider, probe], inputs: {
    "client.components": { register() {} }, "client.env": {}, "client.logger": logger, "client.vue": { provide() {} }
  } });
  await runtime.start();
  return { realtime, runtime };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("every connection, including one to a restarted server, learns the client build that server serves", async (t) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-realtime-served-build-"));
  const previousAppConfig = globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
  let server = null;
  let client = null;
  t.after(async () => {
    await client?.runtime.shutdown();
    await server?.stop();
    if (previousAppConfig === undefined) delete globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
    else globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = previousAppConfig;
    await rm(appRoot, { recursive: true, force: true });
  });
  await writeServedPage(appRoot, FIRST_BUILD);
  server = await startServer({ appRoot });
  const { port } = server;
  client = await startClient(`http://127.0.0.1:${port}`);

  const seen = [];
  client.realtime.onServedClientBuild((buildId) => seen.push(buildId));
  await waitFor(() => seen.length === 1, "the first connection names its build");
  assert.deepEqual(seen, [FIRST_BUILD]);
  const late = [];
  client.realtime.onServedClientBuild((buildId) => late.push(buildId));
  assert.deepEqual(late, [FIRST_BUILD], "a later subscriber receives the latest build at once");

  // An update: the server stops, its built page changes, and a new server starts on the same port.
  await server.stop();
  server = null;
  await writeServedPage(appRoot, SECOND_BUILD);
  server = await startServer({ appRoot, port });
  await waitFor(() => seen.length === 2, "the reconnection names the new build");
  assert.deepEqual(seen, [FIRST_BUILD, SECOND_BUILD]);
  assert.deepEqual(late, [FIRST_BUILD, SECOND_BUILD]);
});

test("a server announces only a build it actually serves, and only to a connected socket", async (t) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-realtime-served-build-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  const handlers = [];
  const io = { on(eventName, handler) { assert.equal(eventName, "connection"); handlers.push(handler); } };
  const warnings = [];
  announceServedClientBuild({ io, appRoot, logger: { warn: (...args) => warnings.push(args) } });
  announceServedClientBuild({ io, appRoot: "", logger });
  assert.equal(handlers.length, 1, "without an app root there is no built page to name");

  const socket = (connected = true) => ({ connected, emitted: [], emit(...args) { this.emitted.push(args); } });
  const withoutBuild = socket();
  await handlers[0](withoutBuild);
  assert.deepEqual(withoutBuild.emitted, [], "development serves no built page");

  await writeServedPage(appRoot, FIRST_BUILD);
  const connected = socket();
  await handlers[0](connected);
  assert.deepEqual(connected.emitted, [["realtime.served-client-build", { buildId: FIRST_BUILD }]]);
  const gone = socket(false);
  await handlers[0](gone);
  assert.deepEqual(gone.emitted, []);
  assert.deepEqual(warnings, []);
});
