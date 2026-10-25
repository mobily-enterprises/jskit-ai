import assert from "node:assert/strict";
import test from "node:test";

import * as serverApi from "../src/server/RealtimeProvider.js";
import * as serverRuntimeApi from "../src/server/runtime.js";
import * as clientApi from "../src/client/RealtimeClientProvider.js";
import * as clientRuntimeApi from "../src/client/runtime.js";

test("server entrypoint exports provider only", () => {
  assert.equal(typeof serverApi.RealtimeProvider, "object");
  assert.deepEqual(Object.keys(serverApi).sort(), ["RealtimeProvider"]);
});

test("client entrypoint exports provider only", () => {
  assert.equal(typeof clientApi.RealtimeClientProvider, "object");
  assert.equal(typeof clientApi.resolveRealtimeClientConfig, "function");
  assert.deepEqual(Object.keys(clientApi).sort(), ["RealtimeClientProvider", "resolveRealtimeClientConfig"]);
});

test("server runtime entrypoint exports server-only helpers", () => {
  assert.equal(typeof serverRuntimeApi.createSocketIoServer, "function");
  assert.equal(typeof serverRuntimeApi.closeSocketIoServer, "function");
});

test("client runtime entrypoint exports client-only helpers", () => {
  assert.equal(typeof clientRuntimeApi.createSocketIoClient, "function");
  assert.equal(typeof clientRuntimeApi.disconnectSocketIoClient, "function");
});

test("package metadata describes exactly the exported subpaths and provided capabilities", async () => {
  const { readFile } = await import("node:fs/promises");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const apiSummary = packageJson.jskit.metadata.apiSummary;
  assert.deepEqual(
    apiSummary.surfaces.map((surface) => surface.subpath).sort(),
    Object.keys(packageJson.exports).sort()
  );
  assert.deepEqual(apiSummary.capabilities, {
    server: Object.values(serverApi.RealtimeProvider.provides),
    client: Object.values(clientApi.RealtimeClientProvider.provides)
  });
  assert.deepEqual(
    [...packageJson.jskit.capabilities.provides].sort(),
    [...apiSummary.capabilities.server, ...apiSummary.capabilities.client].sort()
  );
  assert.equal(Object.hasOwn(packageJson.peerDependencies, "@jskit-ai/shell-web"), false);
});
