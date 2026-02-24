import test from "node:test";
import assert from "node:assert/strict";

async function loadExports(modulePath) {
  return import(modulePath);
}

function assertNoDefaultExport(modulePath, mod) {
  assert.equal(Object.hasOwn(mod, "default"), false, `${modulePath} must not expose a default export.`);
}

function assertRequiredExports(modulePath, mod, requiredExports) {
  for (const [exportName, expectedType] of Object.entries(requiredExports)) {
    assert.equal(typeof mod[exportName], expectedType, `${modulePath} missing ${exportName}`);
  }
}

test("server module indexes expose expected seams", async () => {
  const moduleExpectations = [
    {
      modulePath: "../server/modules/ai/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createAiService: "function",
        createAiTranscriptsService: "function",
        createOpenAiClient: "function"
      }
    },
    {
      modulePath: "../server/modules/api/index.js",
      requiredExports: {
        buildDefaultRoutes: "function"
      }
    },
    {
      modulePath: "../server/modules/auth/index.js",
      requiredExports: {
        createAccountFlows: "function",
        createPasswordSecurityFlows: "function",
        createOauthFlows: "function"
      }
    },
    {
      modulePath: "../server/modules/billing/index.js",
      requiredExports: {
        createBillingProvidersModule: "function",
        createBillingProviderRegistryService: "function",
        createBillingWebhookTranslationRegistryService: "function"
      }
    },
    {
      modulePath: "../server/modules/chat/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createChatService: "function",
        createChatRealtimeService: "function"
      }
    },
    {
      modulePath: "../server/modules/communications/index.js",
      requiredExports: {
        createService: "function",
        buildRoutes: "function"
      }
    },
    {
      modulePath: "../server/modules/console/index.js",
      requiredExports: {
        createController: "function"
      }
    },
    {
      modulePath: "../server/modules/deg2rad/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createService: "function",
        schema: "object"
      }
    },
    {
      modulePath: "../server/modules/health/index.js",
      requiredExports: {
        createService: "function",
        healthRepository: "object"
      }
    },
    {
      modulePath: "../server/modules/history/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createService: "function",
        schema: "object",
        calculationLogsRepository: "object"
      }
    },
    {
      modulePath: "../server/modules/projects/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createService: "function",
        schema: "object",
        projectsRepository: "object"
      }
    },
    {
      modulePath: "../server/modules/settings/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        createService: "function",
        userSettingsRepository: "object"
      }
    },
    {
      modulePath: "../server/modules/workspace/index.js",
      requiredExports: {
        createController: "function",
        buildRoutes: "function",
        schema: "object"
      }
    }
  ];

  for (const expectation of moduleExpectations) {
    const mod = await loadExports(expectation.modulePath);
    assertNoDefaultExport(expectation.modulePath, mod);
    assertRequiredExports(expectation.modulePath, mod, expectation.requiredExports);
  }
});

test("projects schema uses strict CRUD contract", async () => {
  const mod = await loadExports("../server/modules/projects/index.js");
  const { schema } = mod;

  assert.deepEqual(Object.keys(schema).sort(), ["body", "params", "query", "response"]);
  assert.deepEqual(Object.keys(schema.response).sort(), ["list", "single"]);
  assert.deepEqual(Object.keys(schema.body).sort(), ["create", "replace", "update"]);
  assert.equal(Object.hasOwn(schema.body, "levitate"), false);
});

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

test("client API modules expose createApi contract", async () => {
  const modules = [
    "../src/services/api/authApi.js",
    "../src/services/api/billingApi.js",
    "../src/services/api/deg2radApi.js",
    "../src/services/api/workspaceApi.js",
    "../src/services/api/consoleApi.js",
    "../src/services/api/projectsApi.js",
    "../src/services/api/settingsApi.js",
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
    "../src/routes/assistantRoutes.js",
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
