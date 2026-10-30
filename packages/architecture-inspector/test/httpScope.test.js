import assert from "node:assert/strict";
import test from "node:test";
import { inspectVueArchitecture } from "../src/inspectVueArchitecture.js";
import { project } from "./support.js";

// A starter-shaped application: the root manifest names the application, a
// workspace package registers its routes and the client reads them.
const MANIFEST = "{\n  \"name\": \"reading-room\",\n  \"private\": true,\n  \"workspaces\": [\"packages/*\"]\n}\n";
const STARTER = {
  "package.json": MANIFEST,
  "packages/main/src/server/registerRoutes.js": [
    "import { createActionRouteScope } from \"@jskit-ai/kernel/server/http\";",
    "export function registerRoutes(http) {",
    "  const routes = createActionRouteScope(http, { relativePath: \"books\" });",
    "  routes.actionRoute(\"GET\", \"/\", { actionId: \"reading-room.books.list\" });",
    "}",
    ""
  ].join("\n"),
  "src/composables/useBooks.js": [
    "import { useEndpointResource } from \"@jskit-ai/http-web/client/composables/useEndpointResource\";",
    "export function useBooks() {",
    "  return useEndpointResource({ path: \"/api/books\" });",
    "}",
    ""
  ].join("\n")
};

function scopes(result) {
  return {
    capabilities: [result.capabilities.entryOperations, result.capabilities.operationUses],
    entries: result.entryOperations.map(({ key }) => `${key.scope} ${key.method} ${key.operation}`),
    uses: result.operationUses.map(({ key, keyCertainty }) => key && `${key.scope} ${key.method} ${key.operation} ${keyCertainty}`)
  };
}

test("without an explicit HTTP scope the root package name identifies the application", async (t) => {
  const { root, input } = await project(t, STARTER);
  const result = await inspectVueArchitecture({ projectRoot: root, input, calls: true });
  assert.deepEqual(scopes(result), {
    capabilities: ["partial", "partial"],
    entries: ["reading-room GET /api/books"],
    uses: ["reading-room GET /api/books exact"]
  });
  assert.ok(result.inputs.some((entry) => entry.path === "package.json"));
});

test("an explicit HTTP scope overrides the package name", async (t) => {
  const { root, input } = await project(t, STARTER);
  const result = await inspectVueArchitecture({ projectRoot: root, input, calls: true, httpScope: "shop" });
  assert.deepEqual(scopes(result).entries, ["shop GET /api/books"]);
  assert.deepEqual(scopes(result).uses, ["shop GET /api/books exact"]);
});

test("without a named root manifest the HTTP observations stay unconfigured", async (t) => {
  for (const manifest of [{ "package.json": "{\"private\":true}\n" }, { "package.json": "{not json" }, {}]) {
    const { "package.json": _, ...source } = STARTER;
    const { root, input } = await project(t, { ...source, ...manifest });
    const result = await inspectVueArchitecture({ projectRoot: root, input, calls: true });
    assert.deepEqual(scopes(result), { capabilities: ["unconfigured", "unconfigured"], entries: [], uses: [] });
  }
});
