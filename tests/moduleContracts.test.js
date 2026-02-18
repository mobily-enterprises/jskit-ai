import test from "node:test";
import assert from "node:assert/strict";

async function loadExports(modulePath) {
  return import(modulePath);
}

function assertNoLegacyFactoryNames(exportKeys, allowed) {
  for (const key of exportKeys) {
    if (/^create[A-Z].*(Controller|Service|Api|Routes)$/.test(key) && key !== allowed) {
      assert.fail(`Unexpected prefixed contract export "${key}". Expected "${allowed}".`);
    }
    if (/^build[A-Z].*Routes$/.test(key) && key !== allowed) {
      assert.fail(`Unexpected prefixed route export "${key}". Expected "${allowed}".`);
    }
  }
}

function isContractMap(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.prototype.hasOwnProperty.call(value, "type")
  );
}

function assertNoSchemaSuffixKeys(value, path = "schema") {
  if (!isContractMap(value)) {
    return;
  }

  for (const [key, next] of Object.entries(value)) {
    assert.equal(/Schema$/.test(key), false, `Contract key "${path}.${key}" should not end with "Schema".`);
    assertNoSchemaSuffixKeys(next, `${path}.${key}`);
  }
}

test("server controllers expose createController contract", async () => {
  const modules = [
    "../server/modules/annuity/controller.js",
    "../server/modules/auth/controller.js",
    "../server/modules/history/controller.js",
    "../server/modules/projects/controller.js",
    "../server/modules/settings/controller.js",
    "../server/modules/god/controller.js",
    "../server/modules/workspace/controller.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.createController, "function", `${modulePath} missing createController`);
    assertNoLegacyFactoryNames(exportKeys, "createController");
  }
});

test("server services expose createService contract", async () => {
  const modules = [
    "../server/domain/annuity/calculator.service.js",
    "../server/modules/auth/service.js",
    "../server/modules/history/service.js",
    "../server/modules/projects/service.js",
    "../server/modules/settings/service.js",
    "../server/domain/god/services/god.service.js",
    "../server/domain/workspace/services/workspace.service.js",
    "../server/domain/workspace/services/admin.service.js",
    "../server/domain/users/avatar.service.js",
    "../server/domain/users/avatarStorage.service.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.createService, "function", `${modulePath} missing createService`);
    assertNoLegacyFactoryNames(exportKeys, "createService");
  }
});

test("server routes expose buildRoutes contract", async () => {
  const modules = [
    "../server/modules/annuity/routes.js",
    "../server/modules/auth/routes.js",
    "../server/modules/history/routes.js",
    "../server/modules/projects/routes.js",
    "../server/modules/settings/routes.js",
    "../server/modules/god/routes.js",
    "../server/modules/workspace/routes.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.buildRoutes, "function", `${modulePath} missing buildRoutes`);
    assertNoLegacyFactoryNames(exportKeys, "buildRoutes");
  }
});

test("server schemas expose schema object contract", async () => {
  const modules = [
    "../server/modules/annuity/schema.js",
    "../server/modules/auth/schema.js",
    "../server/modules/history/schema.js",
    "../server/modules/projects/schema.js",
    "../server/modules/settings/schema.js",
    "../server/modules/god/schema.js",
    "../server/modules/workspace/schema.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    assert.equal(typeof mod.schema, "object", `${modulePath} missing schema export`);
    assert.notEqual(mod.schema, null, `${modulePath} schema export must be non-null`);
    assertNoSchemaSuffixKeys(mod.schema);
  }
});

test("projects schema uses strict CRUD contract", async () => {
  const mod = await loadExports("../server/modules/projects/schema.js");
  const { schema } = mod;

  assert.deepEqual(Object.keys(schema).sort(), ["body", "params", "query", "response"]);
  assert.deepEqual(Object.keys(schema.response).sort(), ["list", "single"]);
  assert.deepEqual(Object.keys(schema.body).sort(), ["create", "replace", "update"]);
  assert.equal(Object.prototype.hasOwnProperty.call(schema.body, "levitate"), false);
});

test("client API modules expose createApi contract", async () => {
  const modules = [
    "../src/services/api/authApi.js",
    "../src/services/api/workspaceApi.js",
    "../src/services/api/godApi.js",
    "../src/services/api/projectsApi.js",
    "../src/services/api/settingsApi.js",
    "../src/services/api/annuityApi.js",
    "../src/services/api/historyApi.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.createApi, "function", `${modulePath} missing createApi`);
    assertNoLegacyFactoryNames(exportKeys, "createApi");
  }
});

test("client route packs expose createRoutes contract", async () => {
  const modules = [
    "../src/routes/coreRoutes.js",
    "../src/routes/workspaceRoutes.js",
    "../src/routes/projectsRoutes.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.createRoutes, "function", `${modulePath} missing createRoutes`);
    assertNoLegacyFactoryNames(exportKeys, "createRoutes");
  }
});
