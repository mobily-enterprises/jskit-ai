import assert from "node:assert/strict";
import test from "node:test";
import { inspectVueArchitecture } from "../src/inspectVueArchitecture.js";
import { inspectCallsOf, project } from "./support.js";

const ROUTER = { id: "app", adapter: "vue-registered-router", surface: "app", mode: "registered", registrations: ["src/routes.js"], pageRoots: [] };
const ALIAS = [{ client: "/api/notes", route: "/api/app/:slug/notes" }];
const RESOURCE = "import { useEndpointResource } from \"@jskit-ai/http-web/client/composables/useEndpointResource\";";
const CLIENT = "import { getHttpWebClient } from \"@jskit-ai/http-web/client/lib/httpClient\";";

const NOTES = {
  "packages/notes/src/server/routes.js": [
    "import { createActionRouteScope } from \"@jskit-ai/kernel/server/http\";",
    "export function registerRoutes(http) {",
    "  const routes = createActionRouteScope(http, { routeBase: \"/app/:slug\", relativePath: \"notes\" });",
    "  routes.actionRoute(\"GET\", \"/items\", { actionId: \"notes.list\" });",
    "  routes.actionRoute(\"POST\", \"/items\", { actionId: \"notes.create\" });",
    "  routes.actionRoute(\"GET\", \"/items/:itemId\", { actionId: \"notes.read\" });",
    "  routes.actionRoute(\"GET\", \"/archive/:itemId\", { actionId: \"notes.archive.read\" });",
    "}",
    ""
  ].join("\n"),
  "src/composables/useNotes.js": [
    RESOURCE,
    CLIENT,
    "export function useNotes() {",
    "  return useEndpointResource({ path: \"/api/notes/items\" });",
    "}",
    "export function readNote(id) {",
    "  return getHttpWebClient().request(`/api/notes/items/${encodeURIComponent(id)}`);",
    "}",
    "export function readAny(kind, id) {",
    "  return getHttpWebClient().request(`/api/notes/${kind}/${id}`);",
    "}",
    "export function readSomewhere(target) {",
    "  return getHttpWebClient().request(target);",
    "}",
    ""
  ].join("\n"),
  "src/routes.js": "import { createRouter } from \"vue-router\";\nimport Notes from \"./views/Notes.vue\";\ncreateRouter({ routes: [{ path: \"/notes\", component: Notes }] });\n",
  "src/views/Notes.vue": [
    "<template><button @click=\"create\">New</button></template>",
    "<script setup>",
    "import { useCommand } from \"@jskit-ai/http-web/client/composables/useCommand\";",
    "const command = useCommand({ apiSuffix: \"/notes/items\" });",
    "async function create() { await fetch(\"/api/notes/items\", { method: \"POST\" }); }",
    "</script>",
    ""
  ].join("\n")
};

function uses(result) {
  return result.operationUses.map((use) => ({
    id: use.id,
    parentId: use.parentId,
    fromFunctionId: use.fromFunctionId,
    resolution: use.resolution,
    key: use.key && `${use.key.method} ${use.key.operation}`,
    keyCertainty: use.keyCertainty
  }));
}

test("client transports become operation uses from their calling function, with exact and probable keys", async (t) => {
  const { result } = await inspectCallsOf(t, NOTES, { discovery: ROUTER, httpScope: "demo", apiPrefixAliases: ALIAS });
  const page = result.pages.find((entry) => entry.file === "src/views/Notes.vue").id;
  assert.deepEqual(uses(result).sort((left, right) => left.id.localeCompare(right.id)), [
    { id: "operation-use:src/composables/useNotes.js#10:10:GET:1", parentId: undefined, fromFunctionId: "fn:src/composables/useNotes.js#9:8", resolution: "resolved", key: "GET /api/app/:slug/notes/archive/:itemId", keyCertainty: "probable" },
    { id: "operation-use:src/composables/useNotes.js#10:10:GET:2", parentId: undefined, fromFunctionId: "fn:src/composables/useNotes.js#9:8", resolution: "resolved", key: "GET /api/app/:slug/notes/items/:itemId", keyCertainty: "probable" },
    { id: "operation-use:src/composables/useNotes.js#13:10", parentId: undefined, fromFunctionId: "fn:src/composables/useNotes.js#12:8", resolution: "unresolved", key: undefined, keyCertainty: undefined },
    { id: "operation-use:src/composables/useNotes.js#4:10", parentId: undefined, fromFunctionId: "fn:src/composables/useNotes.js#3:8", resolution: "resolved", key: "GET /api/app/:slug/notes/items", keyCertainty: "exact" },
    { id: "operation-use:src/composables/useNotes.js#7:10", parentId: undefined, fromFunctionId: "fn:src/composables/useNotes.js#6:8", resolution: "resolved", key: "GET /api/app/:slug/notes/items/:itemId", keyCertainty: "exact" },
    { id: "operation-use:src/views/Notes.vue#4:17", parentId: page, fromFunctionId: "fn:src/views/Notes.vue#module", resolution: "resolved", key: "POST /api/app/:slug/notes/items", keyCertainty: "exact" },
    { id: "operation-use:src/views/Notes.vue#5:33", parentId: page, fromFunctionId: "fn:src/views/Notes.vue#5:1", resolution: "resolved", key: "POST /api/app/:slug/notes/items", keyCertainty: "exact" }
  ]);
  for (const use of result.operationUses) {
    assert.equal(use.evidence[0].path, use.id.slice("operation-use:".length).split("#")[0]);
  }
  assert.equal(result.capabilities.operationUses, "partial");
});

test("without the prefix alias the client paths do not reach the scoped routes", async (t) => {
  const { result } = await inspectCallsOf(t, NOTES, { discovery: ROUTER, httpScope: "demo" });
  assert.ok(result.operationUses.every((use) => use.resolution === "unresolved"));
});

test("prefix aliases must be absolute prefixes without a trailing slash", async (t) => {
  const { root, input } = await project(t, NOTES, { discovery: ROUTER });
  await assert.rejects(inspectVueArchitecture({ projectRoot: root, input, httpScope: "demo", calls: true, apiPrefixAliases: [{ client: "api/notes", route: "/api" }] }));
  await assert.rejects(inspectVueArchitecture({ projectRoot: root, input, httpScope: "demo", calls: true, apiPrefixAliases: [{ client: "/api/notes/", route: "/api" }] }));
});

test("without --calls operation uses keep their page and component form", async (t) => {
  const { root, input } = await project(t, NOTES, { discovery: ROUTER });
  const result = await inspectVueArchitecture({ projectRoot: root, input, httpScope: "demo", apiPrefixAliases: ALIAS });
  assert.ok(result.operationUses.length > 0);
  for (const use of result.operationUses) {
    assert.ok(use.parentId);
    assert.equal("fromFunctionId" in use, false);
    assert.equal("keyCertainty" in use, false);
  }
});
