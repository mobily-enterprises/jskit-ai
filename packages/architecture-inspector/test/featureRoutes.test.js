import assert from "node:assert/strict";
import test from "node:test";
import { callsFrom, inspectCallsOf, project } from "./support.js";

const FEATURE = "import { defineFeature } from \"@jskit-ai/kernel/server/features\";";

// The account preferences shape: a route registered on the router the
// feature's setup passes on, an action built by create*Actions around a
// JSDoc-typed service, and a repository the service names by type.
const PREFERENCES = {
  "packages/users/src/server/common/userSettingsRepository.js": [
    "export function createRepository(knex) {",
    "  async function updatePreferences(id, patch) { return knex(\"settings\").where({ id }).update(patch); }",
    "  return Object.freeze({ updatePreferences });",
    "}",
    ""
  ].join("\n"),
  "packages/users/src/server/accountPreferences/accountPreferencesService.js": [
    "/** @typedef {ReturnType<typeof import(\"../common/userSettingsRepository.js\").createRepository>} UserSettingsRepository */",
    "/**",
    " * @param {object} dependencies",
    " * @param {UserSettingsRepository} dependencies.userSettingsRepository",
    " */",
    "function createService({ userSettingsRepository }) {",
    "  async function updatePreferences(request, user, payload) {",
    "    return userSettingsRepository.updatePreferences(user.id, payload);",
    "  }",
    "  return Object.freeze({ updatePreferences });",
    "}",
    "/** @typedef {ReturnType<typeof createService>} AccountPreferencesService */",
    "export { createService };",
    ""
  ].join("\n"),
  "packages/users/src/server/accountPreferences/accountPreferencesActions.js": [
    "const READ_PREFERENCES = \"settings.preferences.read\";",
    "/** @param {{ accountPreferencesService: import(\"./accountPreferencesService.js\").AccountPreferencesService }} dependencies */",
    "function createAccountPreferencesActions({ accountPreferencesService }) {",
    "  return Object.freeze([",
    "    Object.freeze({",
    "      id: \"settings.preferences.update\",",
    "      execute: (input, context) => accountPreferencesService.updatePreferences(context.request, context.user, input)",
    "    }),",
    "    Object.freeze({",
    "      id: READ_PREFERENCES,",
    "      execute: (input, context) => accountPreferencesService.updatePreferences(context.request, context.user, {})",
    "    })",
    "  ]);",
    "}",
    "export { createAccountPreferencesActions };",
    ""
  ].join("\n"),
  "packages/users/src/server/accountPreferences/bootAccountPreferencesRoutes.js": [
    "function registerAccountPreferencesRoutes(router) {",
    "  router.register(\"PATCH\", \"/api/settings/preferences\", { auth: \"required\" }, async function (request, reply) {",
    "    const response = await request.executeAction({ actionId: \"settings.preferences.update\", input: request.input.body });",
    "    reply.code(200).send(response);",
    "  });",
    "}",
    "export { registerAccountPreferencesRoutes };",
    ""
  ].join("\n"),
  "packages/users/src/server/accountPreferences/index.js": "export { registerAccountPreferencesRoutes } from \"./bootAccountPreferencesRoutes.js\";\n",
  "packages/users/src/server/UsersFeature.js": [
    FEATURE,
    "import { createAccountPreferencesActions } from \"./accountPreferences/accountPreferencesActions.js\";",
    "import { createService } from \"./accountPreferences/accountPreferencesService.js\";",
    "import { registerAccountPreferencesRoutes } from \"./accountPreferences/index.js\";",
    "import { createRepository } from \"./common/userSettingsRepository.js\";",
    "function createUsersRuntime({ knex }) {",
    "  const accountPreferencesService = createService({ userSettingsRepository: createRepository(knex) });",
    "  return Object.freeze({ services: Object.freeze({ accountPreferences: accountPreferencesService }) });",
    "}",
    "const UsersFeature = defineFeature({",
    "  requires: { http: \"runtime.http\", knex: \"runtime.knex\" },",
    "  provides: { users: \"users.core\" },",
    "  async setup({ http, knex }) {",
    "    const users = createUsersRuntime({ knex });",
    "    registerAccountPreferencesRoutes(http.router);",
    "    return { users };",
    "  },",
    "  actions({ users }) {",
    "    return [...createAccountPreferencesActions({ accountPreferencesService: users.services.accountPreferences })];",
    "  }",
    "});",
    "export { UsersFeature };",
    ""
  ].join("\n")
};

const HANDLER = "fn:packages/users/src/server/accountPreferences/bootAccountPreferencesRoutes.js#2:79";
const UPDATE = "fn:packages/users/src/server/accountPreferences/accountPreferencesActions.js#7:16";
const SERVICE = "fn:packages/users/src/server/accountPreferences/accountPreferencesService.js#7:3";
const REPOSITORY = "fn:packages/users/src/server/common/userSettingsRepository.js#2:3";

test("actions built by create*Actions are action entry points that executeAction reaches exactly", async (t) => {
  const { result } = await inspectCallsOf(t, PREFERENCES, { httpScope: "demo" });
  assert.deepEqual(result.entryPoints.map((entry) => [entry.id, entry.file, entry.functionIds]), [
    ["entry:action:settings.preferences.update", "packages/users/src/server/accountPreferences/accountPreferencesActions.js", [UPDATE]],
    ["entry:action:settings.preferences.read", "packages/users/src/server/accountPreferences/accountPreferencesActions.js",
      ["fn:packages/users/src/server/accountPreferences/accountPreferencesActions.js#11:16"]]
  ]);
  const facts = (callee) => callsFrom(result, callee).map((call) => [call.fromFunctionId, call.certainty, call.method, call.targets]);
  // The route reaches the action, the action its typed service, and the
  // service its typed repository, each in one exact step.
  assert.deepEqual(facts("request.executeAction"), [[HANDLER, "exact", "route-action", [UPDATE]]]);
  assert.deepEqual(facts("accountPreferencesService.updatePreferences"), [
    [UPDATE, "exact", "checker", [SERVICE]],
    ["fn:packages/users/src/server/accountPreferences/accountPreferencesActions.js#11:16", "exact", "checker", [SERVICE]]
  ]);
  assert.deepEqual(facts("userSettingsRepository.updatePreferences"), [[SERVICE, "exact", "checker", [REPOSITORY]]]);
});

test("routes registered on the router a setup passes on reach their handler", async (t) => {
  const { result } = await inspectCallsOf(t, PREFERENCES, { httpScope: "demo" });
  assert.deepEqual(result.entryOperations.map((entry) => [entry.key.method, entry.key.operation, entry.controllerFile, entry.controllerFunctionId, entry.actionId]), [
    ["PATCH", "/api/settings/preferences", "packages/users/src/server/accountPreferences/bootAccountPreferencesRoutes.js", HANDLER, undefined]
  ]);
  assert.equal(result.entryOperations[0].id, "entry:demo:packages/users/src/server/accountPreferences/bootAccountPreferencesRoutes.js:54");
  assert.deepEqual(result.diagnostics.filter((entry) => entry.code === "CONTROLLER_UNRESOLVED"), []);
});

const ROUTES = {
  "packages/notes/src/server/paths.js": [
    "import { resolveScopedApiBasePath } from \"@jskit-ai/kernel/shared/surface\";",
    "export function registerScopedRoutes(router) {",
    "  const base = resolveScopedApiBasePath({ routeBase: \"/w/:workspaceSlug\", relativePath: \"notes\", strictParams: false });",
    "  router.register(\"GET\", `${base}/:noteId`, {}, async (request) => request.executeAction({ actionId: \"notes.read\" }));",
    "  router.register(\"POST\", resolveScopedApiBasePath({ relativePath: \"notes\" }), {}, function create() { return 1; });",
    "  router.register(\"GET\", request.dynamicPath, {}, () => 2);",
    "  forward(router);",
    "}",
    "function forward(target) {",
    "  target.register(\"DELETE\", \"/api/notes\", {}, () => 3);",
    "  [1].forEach((target) => target.register(\"GET\", \"/api/shadowed\", {}, () => 4));",
    "}",
    ""
  ].join("\n"),
  "packages/notes/src/server/NotesFeature.js": [
    FEATURE,
    "import { registerScopedRoutes } from \"./paths.js\";",
    "export const NotesFeature = defineFeature({",
    "  setup(dependencies) {",
    "    registerScopedRoutes(dependencies.http.router);",
    "    dependencies.http.router.register(\"PUT\", \"/api/notes/order\", {}, async () => 5);",
    "    dependencies.bootstrap.register({ id: \"notes\", contribute() {} });",
    "    return {};",
    "  }",
    "});",
    ""
  ].join("\n"),
  "packages/notes/src/server/OtherFeature.js": [
    FEATURE,
    "import { registerScopedRoutes } from \"./paths.js\";",
    "export const Plain = defineFeature({ setup() { return {}; } });",
    "export const OtherFeature = defineFeature({",
    "  setup({ http: web }) { web.router.register(\"GET\", \"/api/other\", {}, () => 7); registerScopedRoutes(web.router); return {}; }",
    "});",
    ""
  ].join("\n"),
  "packages/notes/src/server/unrelated.js": [
    "export function registerPlugins(router) { router.register(\"GET\", \"/api/not-a-feature\", {}, () => 6); }",
    ""
  ].join("\n")
};

test("router flow follows parameters, renamed and whole dependencies, and records each registration once", async (t) => {
  const { result } = await inspectCallsOf(t, ROUTES, { httpScope: "demo" });
  const entries = result.entryOperations.map((entry) => [entry.key.method, entry.key.operation, entry.controllerFunctionId]);
  assert.deepEqual(entries.sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0])), [
    ["DELETE", "/api/notes", "fn:packages/notes/src/server/paths.js#10:47"],
    ["POST", "/api/notes", "fn:packages/notes/src/server/paths.js#5:84"],
    ["PUT", "/api/notes/order", "fn:packages/notes/src/server/NotesFeature.js#6:70"],
    ["GET", "/api/other", "fn:packages/notes/src/server/OtherFeature.js#5:71"],
    ["GET", "/api/w/:workspaceSlug/notes/:noteId", "fn:packages/notes/src/server/paths.js#4:49"]
  ]);
  // A dynamic path is reported once; a shadowed name, the bootstrap
  // registry and a function no setup reaches create nothing.
  assert.deepEqual(result.diagnostics.filter((entry) => entry.code === "CONTROLLER_UNRESOLVED").map((entry) => entry.path),
    ["packages/notes/src/server/paths.js"]);
});

test("without --calls router flow still gives entry operations, without controller functions", async (t) => {
  const { root, input } = await project(t, ROUTES);
  const { inspectVueArchitecture } = await import("../src/inspectVueArchitecture.js");
  const result = await inspectVueArchitecture({ projectRoot: root, input, httpScope: "demo" });
  assert.equal(result.entryOperations.length, 5);
  assert.ok(result.entryOperations.every((entry) => !("controllerFunctionId" in entry)));
});

const CRUD = {
  "packages/receivals/src/shared/receivalResource.js": [
    "import { defineCrudResource } from \"@jskit-ai/resource-crud-core/shared/crudResource\";",
    "const resource = defineCrudResource({ namespace: \"receivals\", tableName: \"receivals\", crudOperations: [\"list\", \"view\"] });",
    "export { resource };",
    ""
  ].join("\n"),
  "packages/receivals/src/server/receivalActions.js": [
    "const receivalActions = {",
    "  \"place-in-freezer\": {",
    "    id: \"crud.receivals.placeInFreezer\",",
    "    execute({ input, service }) { return service.placeInFreezer(input.recordId); },",
    "    route: { method: \"post\", path: \"/:recordId/place-in-freezer\" }",
    "  },",
    "  reopen: {",
    "    execute({ input, service }) { return service.reopen(input.recordId); },",
    "    route: { path: \"/:recordId/reopen\" }",
    "  },",
    "  recount: {",
    "    execute({ service }) { return service.recount(); }",
    "  }",
    "};",
    "export { receivalActions };",
    ""
  ].join("\n"),
  "packages/receivals/src/server/actions.js": "export { receivalActions } from \"./receivalActions.js\";\n",
  "packages/receivals/src/server/ReceivalsFeature.js": [
    "import { defineCrudJsonApiFeature } from \"@jskit-ai/crud-core/server/defineCrudJsonApiFeature\";",
    "import { resource } from \"../shared/receivalResource.js\";",
    "import { receivalActions } from \"./actions.js\";",
    "const ReceivalsFeature = defineCrudJsonApiFeature({",
    "  resource,",
    "  surface: \"home\",",
    "  relativePath: \"/receivals\",",
    "  scope: { routeBase: \"/w/:workspaceSlug\", input: (request) => request.input.params },",
    "  actions: receivalActions",
    "});",
    "export { ReceivalsFeature };",
    ""
  ].join("\n"),
  "packages/receivals/src/server/trigger.js": [
    "export async function placeAll(request) {",
    "  await request.executeAction({ actionId: \"crud.receivals.placeInFreezer\" });",
    "  await request.executeAction({ actionId: \"receivals.recount\" });",
    "}",
    ""
  ].join("\n")
};

const FREEZE = "fn:packages/receivals/src/server/receivalActions.js#4:5";
const REOPEN = "fn:packages/receivals/src/server/receivalActions.js#8:5";
const RECOUNT = "fn:packages/receivals/src/server/receivalActions.js#12:5";

test("CRUD declarations name each route's action, and custom action routes reach their execute", async (t) => {
  const { result } = await inspectCallsOf(t, CRUD, { httpScope: "demo" });
  const entries = result.entryOperations.map((entry) => [entry.key.protocol, entry.key.method, entry.key.operation, entry.actionId, entry.controllerFile, entry.controllerFunctionId]);
  assert.deepEqual(entries, [
    ["jskit.crud", undefined, "receivals:list", "crud.receivals.list", "packages/receivals/src/server/ReceivalsFeature.js", undefined],
    ["jskit.crud", undefined, "receivals:view", "crud.receivals.view", "packages/receivals/src/server/ReceivalsFeature.js", undefined],
    ["http", "POST", "/api/w/:workspaceSlug/receivals/:recordId/place-in-freezer", "crud.receivals.placeInFreezer", "packages/receivals/src/server/receivalActions.js", FREEZE],
    ["http", "POST", "/api/w/:workspaceSlug/receivals/:recordId/reopen", "receivals.reopen", "packages/receivals/src/server/receivalActions.js", REOPEN]
  ]);
  assert.deepEqual(result.entryPoints.map((entry) => [entry.id, entry.file, entry.functionIds]), [
    ["entry:action:crud.receivals.placeInFreezer", "packages/receivals/src/server/receivalActions.js", [FREEZE]],
    ["entry:action:receivals.reopen", "packages/receivals/src/server/receivalActions.js", [REOPEN]],
    ["entry:action:receivals.recount", "packages/receivals/src/server/receivalActions.js", [RECOUNT]]
  ]);
  assert.deepEqual(callsFrom(result, "request.executeAction").map((call) => [call.certainty, call.method, call.targets]), [
    ["exact", "route-action", [FREEZE]],
    ["exact", "route-action", [RECOUNT]]
  ]);
  assert.deepEqual(result.diagnostics.filter((entry) => entry.code.startsWith("CRUD_") || entry.code.startsWith("ACTION_")), []);
});

test("CRUD custom action routes outside the literal forms are reported, not guessed", async (t) => {
  const { result } = await inspectCallsOf(t, {
    ...CRUD,
    "packages/receivals/src/server/receivalActions.js": [
      "export const receivalActions = {",
      "  move: { execute() { return 1; }, route: { method: \"POST\", path: process.env.MOVE_PATH } },",
      "  copy: { id: process.env.COPY_ID, execute() { return 2; }, route: { path: \"/copy\" } }",
      "};",
      ""
    ].join("\n")
  }, { httpScope: "demo" });
  assert.deepEqual(result.entryOperations.map((entry) => entry.key.protocol), ["jskit.crud", "jskit.crud"]);
  assert.deepEqual(result.entryPoints.map((entry) => entry.id), ["entry:action:receivals.move"]);
  assert.deepEqual(result.diagnostics.filter((entry) => entry.code.startsWith("CRUD_") || entry.code.startsWith("ACTION_")).map((entry) => [entry.code, entry.path]), [
    ["CRUD_ACTION_ROUTE_UNRESOLVED", "packages/receivals/src/server/receivalActions.js"],
    ["CRUD_ACTION_ROUTE_UNRESOLVED", "packages/receivals/src/server/receivalActions.js"],
    ["ACTION_ID_UNRESOLVED", "packages/receivals/src/server/receivalActions.js"]
  ]);
});
