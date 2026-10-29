import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPinia } from "pinia";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { createClientComponentRegistry } from "../../kernel/client/componentRegistry.js";
import { RealtimeClientProvider } from "../../realtime/src/client/RealtimeClientProvider.js";
import { RealtimeProvider } from "../../realtime/src/server/RealtimeProvider.js";
import { ShellWebClientProvider } from "../src/client/providers/ShellWebClientProvider.js";

const CLIENT_APP_CONFIG_GLOBAL_KEY = "__JSKIT_CLIENT_APP_CONFIG__";
const PAGE_BUILD = "aaaaaaaaaaaaaaaa";
const NEW_BUILD = "bbbbbbbbbbbbbbbb";
const NEWER_BUILD = "cccccccccccccccc";
const logger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

const originalGlobals = new WeakMap();

// Each global is restored to its value from before the test, however often the test sets it.
function setGlobal(t, name, value) {
  if (!originalGlobals.has(t)) {
    const originals = new Map();
    originalGlobals.set(t, originals);
    t.after(() => {
      for (const [key, original] of originals) {
        if (original.had) globalThis[key] = original.value;
        else delete globalThis[key];
      }
    });
  }
  const originals = originalGlobals.get(t);
  if (!originals.has(name)) {
    originals.set(name, { had: Object.hasOwn(globalThis, name), value: globalThis[name] });
  }
  globalThis[name] = value;
}

// The page as it loaded: its <title> and, when built, its build id.
function loadPage(t, { buildId = PAGE_BUILD, title = "Vibe Test" } = {}) {
  setGlobal(t, "document", Object.assign(new EventTarget(), {
    hidden: false,
    title,
    querySelector: (selector) => (selector === 'meta[name="jskit-client-build"]' && buildId
      ? { getAttribute: (name) => (name === "content" ? buildId : null) }
      : null)
  }));
}

// The shape of client.realtime's served-build subscription, driven by the test.
function createRealtimeStandIn() {
  const listeners = new Set();
  let latest = "";
  return {
    connect(buildId) {
      latest = buildId;
      for (const listener of [...listeners]) listener(buildId);
    },
    listenerCount: () => listeners.size,
    capability: {
      onServedClientBuild(listener) {
        listeners.add(listener);
        if (latest) listener(latest);
        return () => listeners.delete(listener);
      }
    }
  };
}

// Starts the client with the shell (and any other providers), and returns the
// capabilities the probe names once they are set up.
async function startClient(t, { inputs = {}, providers = [], probe = { shell: "client.shell" } } = {}) {
  setGlobal(t, "fetch", async () => ({ ok: true, status: 200, json: async () => ({}) }));
  const captured = {};
  const Probe = defineProvider({
    id: "test.client-update.probe",
    requires: probe,
    setup(dependencies) {
      Object.assign(captured, dependencies);
    }
  });
  const runtime = createCapabilityRuntime({
    profile: "test",
    providers: [ShellWebClientProvider, ...providers, Probe],
    inputs: {
      "client.components": createClientComponentRegistry(),
      "client.env": {},
      "client.logger": logger,
      "client.pinia": createPinia(),
      "client.query": null,
      "client.router": { currentRoute: { value: { path: "/" } }, onError: () => () => {} },
      "client.surface": createSurfaceRuntime({
        allMode: "all",
        surfaces: { app: { id: "app", pagesRoot: "app", enabled: true } },
        defaultSurfaceId: "app"
      }),
      "client.vue": { config: {}, provide() {}, use() { return this; } },
      ...inputs
    }
  });
  await runtime.start();
  t.after(() => (runtime.diagnostics().lifecycleState === "started" ? runtime.shutdown() : null));
  return { runtime, ...captured };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function banners(shell) {
  return shell.errorPresentationStore.getState().channels.banner;
}

test("a page running an older build offers a reload once; the served build itself shows nothing", async (t) => {
  loadPage(t);
  const realtime = createRealtimeStandIn();
  const { shell } = await startClient(t, { inputs: { "client.realtime": realtime.capability } });

  realtime.connect(PAGE_BUILD);
  assert.deepEqual(banners(shell), [], "the page already runs the build its server serves");

  realtime.connect(NEW_BUILD);
  assert.equal(banners(shell).length, 1);
  const [offer] = banners(shell);
  assert.equal(offer.message, "Vibe Test was updated. Reload to get the latest version.");
  assert.equal(offer.messageCode, "shell.recovery.appUpdated");
  assert.equal(offer.severity, "info");
  assert.equal(offer.action.label, "Reload");

  realtime.connect(NEW_BUILD);
  assert.equal(banners(shell).length, 1, "a reconnection to the same build does not repeat the offer");

  // Reload returns to the same address, and only when the person chooses it.
  const reloads = [];
  const checks = [];
  setGlobal(t, "window", Object.assign(new EventTarget(), {
    location: { href: "http://app.test/app/project?tab=chat", reload: () => reloads.push("reload") }
  }));
  setGlobal(t, "fetch", async (url, options) => {
    checks.push({ url, cache: options.cache });
    return { ok: true, status: 200 };
  });
  assert.deepEqual(reloads, [], "the page never reloads by itself");
  assert.equal(await offer.action.handler(), true);
  assert.deepEqual(checks, [{ url: "http://app.test/app/project?tab=chat", cache: "no-store" }]);
  assert.deepEqual(reloads, ["reload"]);
});

test("a closed offer stays closed for its build, a newer build offers again, and the served page build withdraws it", async (t) => {
  loadPage(t, { title: "" });
  const realtime = createRealtimeStandIn();
  const { shell } = await startClient(t, { inputs: { "client.realtime": realtime.capability } });

  realtime.connect(NEW_BUILD);
  assert.equal(banners(shell)[0].message, "This app was updated. Reload to get the latest version.");
  shell.error.dismiss(banners(shell)[0].id);
  realtime.connect(NEW_BUILD);
  assert.deepEqual(banners(shell), [], "the person closed the offer for this build");

  realtime.connect(NEWER_BUILD);
  assert.equal(banners(shell).length, 1, "a newer update offers again");
  realtime.connect(PAGE_BUILD);
  assert.deepEqual(banners(shell), [], "a server back on the page's own build withdraws the offer");

  assert.equal(realtime.listenerCount(), 1);
  await shell.clientUpdate.dispose();
  assert.equal(realtime.listenerCount(), 0);
});

test("a development page, which has no build id, never offers a reload", async (t) => {
  loadPage(t, { buildId: "" });
  const realtime = createRealtimeStandIn();
  const { shell } = await startClient(t, { inputs: { "client.realtime": realtime.capability } });
  realtime.connect(NEW_BUILD);
  assert.deepEqual(banners(shell), []);
});

test("reconnecting to a restarted server that serves a new build offers a reload", async (t) => {
  loadPage(t);
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "shell-client-update-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  async function serve(buildId) {
    await mkdir(path.join(appRoot, "dist"), { recursive: true });
    await writeFile(path.join(appRoot, "dist", "index.html"),
      `<!doctype html><html><head><meta name="jskit-client-build" content="${buildId}"></head></html>`);
  }
  // One server process: its own HTTP server and realtime runtime.
  async function startServer(port = 0) {
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

  await serve(PAGE_BUILD);
  let server = await startServer();
  const { port } = server;
  t.after(() => server?.stop());
  setGlobal(t, CLIENT_APP_CONFIG_GLOBAL_KEY, Object.freeze({ realtimeClient: {
    url: `http://127.0.0.1:${port}`,
    options: { transports: ["websocket"], reconnectionDelay: 50, reconnectionDelayMax: 100, randomizationFactor: 0 }
  } }));
  const { runtime: client, realtime, shell } = await startClient(t, {
    providers: [RealtimeClientProvider],
    probe: { realtime: "client.realtime", shell: "client.shell" }
  });
  const served = [];
  realtime.onServedClientBuild((buildId) => served.push(buildId));
  await waitFor(() => served.length === 1, "the server names the build it serves");
  assert.deepEqual(banners(shell), [], "connected to a server that serves this page's build");

  await server.stop();
  server = null;
  await serve(NEW_BUILD);
  server = await startServer(port);
  await waitFor(() => banners(shell).length === 1, "the reconnection offers a reload");
  assert.equal(banners(shell)[0].message, "Vibe Test was updated. Reload to get the latest version.");
  assert.deepEqual(served, [PAGE_BUILD, NEW_BUILD]);
  await client.shutdown();
});
