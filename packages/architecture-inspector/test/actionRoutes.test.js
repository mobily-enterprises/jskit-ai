import assert from "node:assert/strict";
import test from "node:test";
import { callsFrom, inspectCallsOf, project } from "./support.js";

// The System Graph shape: routes unrolled from a literal array, actions
// unrolled with `.map` through a pass-through wrapper, one shared execute.
const GRAPH = {
  "packages/graph/src/shared/names.js": "export const GRAPH_PATH = \"graph\";\n",
  "packages/graph/src/server/registerRoutes.js": [
    "import { createActionRouteScope } from \"@jskit-ai/kernel/server/http\";",
    "import { GRAPH_PATH } from \"../shared/names.js\";",
    "const sessionRoute = \"/sessions/:sessionId\";",
    "export function registerRoutes(http) {",
    "  const routes = createActionRouteScope(http, { routeBase: \"/app/:slug\", relativePath: GRAPH_PATH, surface: \"app\" });",
    "  for (const [method, suffix, operation] of [",
    "    [\"GET\", \"status\", \"status.read\"],",
    "    [\"POST\", \"refresh\", \"refresh\"]",
    "  ]) routes.actionRoute(method, `${sessionRoute}/${suffix}`, {",
    "    actionId: `demo.graph.${operation}`,",
    "    buildInput: (request) => ({ sessionId: request.params.sessionId })",
    "  });",
    "  routes.serviceRoute(\"POST\", \"/refresh-all\", {}, async function refreshAll(request) {",
    "    return request.executeAction({ actionId: \"demo.graph.refresh\", input: {} });",
    "  });",
    "  routes.actionRoute(\"GET\", http.suffix, { actionId: \"demo.graph.dynamic\" });",
    "}",
    ""
  ].join("\n"),
  "packages/graph/src/server/actions.js": [
    "function withContext(action) { return { ...action, channels: [\"api\"] }; }",
    "export function createGraphActions({ graph }) {",
    "  return [",
    "    [\"status.read\", \"readStatus\"],",
    "    [\"refresh\", \"refresh\"]",
    "  ].map(([operation, method]) => withContext({",
    "    id: `demo.graph.${operation}`,",
    "    execute: (input) => graph[method](input)",
    "  }));",
    "}",
    ""
  ].join("\n"),
  "packages/graph/src/server/feature.js": [
    "import { defineFeature } from \"@jskit-ai/kernel/server/features\";",
    "import { createGraphActions } from \"./actions.js\";",
    "import { registerRoutes } from \"./registerRoutes.js\";",
    "function createGraph() { return { readStatus() { return 1; }, refresh() { return 2; } }; }",
    "export default defineFeature({",
    "  requires: { http: \"runtime.http\" },",
    "  provides: { graph: \"demo.graph\" },",
    "  setup({ http }) { registerRoutes(http); const graph = createGraph(); return { graph }; },",
    "  actions: createGraphActions",
    "});",
    ""
  ].join("\n")
};

const EXECUTE = "fn:packages/graph/src/server/actions.js#8:14";

test("action route scopes give entry operations their path, action and exact controller", async (t) => {
  const { result } = await inspectCallsOf(t, GRAPH, { httpScope: "demo" });
  const entries = result.entryOperations.map((entry) => [entry.key.method, entry.key.operation, entry.actionId, entry.controllerFunctionId]);
  assert.deepEqual(entries.sort((left, right) => left[1].localeCompare(right[1])), [
    ["POST", "/api/app/:slug/graph/refresh-all", undefined, "fn:packages/graph/src/server/registerRoutes.js#13:51"],
    ["POST", "/api/app/:slug/graph/sessions/:sessionId/refresh", "demo.graph.refresh", EXECUTE],
    ["GET", "/api/app/:slug/graph/sessions/:sessionId/status", "demo.graph.status.read", EXECUTE]
  ]);
  assert.ok(result.entryOperations.every((entry) => entry.key.scope === "demo" && entry.resolution === "resolved"));
  assert.deepEqual(result.diagnostics.filter((entry) => entry.code.startsWith("ACTION_")).map((entry) => [entry.code, entry.path]),
    [["ACTION_ROUTE_UNRESOLVED", "packages/graph/src/server/registerRoutes.js"]]);
});

test("named actions become action entry points, and executeAction calls reach them exactly", async (t) => {
  const { result } = await inspectCallsOf(t, GRAPH, { httpScope: "demo" });
  assert.deepEqual(result.entryPoints.map((entry) => [entry.id, entry.kind, entry.title, entry.file, entry.functionIds, entry.actionId]), [
    ["entry:action:demo.graph.status.read", "action", "demo.graph.status.read", "packages/graph/src/server/actions.js", [EXECUTE], "demo.graph.status.read"],
    ["entry:action:demo.graph.refresh", "action", "demo.graph.refresh", "packages/graph/src/server/actions.js", [EXECUTE], "demo.graph.refresh"]
  ]);
  const [entry] = result.entryPoints;
  assert.deepEqual(Object.keys(entry), ["id", "resolution", "kind", "title", "file", "functionIds", "pageId", "componentId", "operationKey", "actionId", "evidence"]);
  assert.deepEqual([entry.pageId, entry.componentId, entry.operationKey], [null, null, null]);

  const [execute] = callsFrom(result, "request.executeAction");
  assert.deepEqual([execute.resolution, execute.certainty, execute.method, execute.targets], ["resolved", "exact", "route-action", [EXECUTE]]);
  // One execute serves both unrolled actions, so its call is ambiguous between
  // the injected service's two methods.
  const [dispatch] = callsFrom(result, "graph[method]");
  assert.deepEqual([dispatch.resolution, dispatch.certainty, dispatch.method, dispatch.targets], ["ambiguous", "probable", "di-binding",
    ["fn:packages/graph/src/server/feature.js#4:35", "fn:packages/graph/src/server/feature.js#4:63"]]);
  assert.equal(result.capabilities.entryPoints, "partial");
});

test("action routes outside the static recognition forms are reported, not guessed", async (t) => {
  const { result } = await inspectCallsOf(t, {
    "src/server/routes.js": [
      "import { createActionRouteScope } from \"@jskit-ai/kernel/server/http\";",
      "export function register(http, options) {",
      "  createActionRouteScope(http, { relativePath: \"loose\" }).actionRoute(\"GET\", \"/x\", { actionId: \"demo.x\" });",
      "  const scoped = createActionRouteScope(http, { relativePath: options.path });",
      "  scoped.actionRoute(\"GET\", \"/y\", { actionId: \"demo.y\" });",
      "}",
      ""
    ].join("\n")
  }, { httpScope: "demo" });
  assert.deepEqual(result.entryOperations, []);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code).filter((code) => code.startsWith("ACTION_")).sort(),
    ["ACTION_ROUTE_SCOPE_UNBOUND", "ACTION_ROUTE_UNRESOLVED"]);
});

test("without --calls action routes still give entry operations, without controller functions", async (t) => {
  const { root, input } = await project(t, GRAPH);
  const { inspectVueArchitecture } = await import("../src/inspectVueArchitecture.js");
  const result = await inspectVueArchitecture({ projectRoot: root, input, httpScope: "demo" });
  assert.equal(result.entryOperations.length, 3);
  assert.ok(result.entryOperations.every((entry) => !("controllerFunctionId" in entry)));
  assert.deepEqual(result.entryOperations.map((entry) => entry.actionId).filter(Boolean).sort(), ["demo.graph.refresh", "demo.graph.status.read"]);
});
