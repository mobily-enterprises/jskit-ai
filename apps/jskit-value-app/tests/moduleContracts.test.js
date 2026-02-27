import test from "node:test";
import assert from "node:assert/strict";

async function loadExports(modulePath) {
  return import(modulePath);
}

function assertNoDefaultExport(modulePath, mod) {
  assert.equal(Object.hasOwn(mod, "default"), false, `${modulePath} must not expose a default export.`);
}

function assertExactExportContract(modulePath, mod, requiredExports) {
  const expectedExportNames = Object.keys(requiredExports).sort();
  const actualExportNames = Object.keys(mod).sort();
  assert.deepEqual(
    actualExportNames,
    expectedExportNames,
    `${modulePath} export contract drifted.\nexpected: ${expectedExportNames.join(", ")}\nactual: ${actualExportNames.join(", ")}`
  );
}

function assertRequiredExports(modulePath, mod, requiredExports) {
  for (const [exportName, expectedType] of Object.entries(requiredExports)) {
    assert.equal(typeof mod[exportName], expectedType, `${modulePath} missing ${exportName}`);
  }
}

function assertNoTestablesLeak(label, value) {
  assert.equal(Object.hasOwn(value, "__testables"), false, `${label} must not expose __testables.`);
}

function assertKeyedObjectContract(label, value, expectedKeys) {
  assert.equal(Array.isArray(value), false, `${label} must return an object contract (not an array).`);
  assert.equal(typeof value, "object", `${label} must return an object contract.`);
  assert.notEqual(value, null, `${label} must return an object contract.`);
  assertNoTestablesLeak(label, value);

  const actualKeys = Object.keys(value).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();
  assert.deepEqual(actualKeys, normalizedExpectedKeys, `${label} returned unexpected keys.`);

  for (const [key, item] of Object.entries(value)) {
    assert.equal(Array.isArray(item), false, `${label}.${key} must not be an array.`);
    assert.notEqual(item, undefined, `${label}.${key} must be defined.`);

    if (item && typeof item === "object") {
      assertNoTestablesLeak(`${label}.${key}`, item);
    }
  }
}

const MODULE_EXPORT_EXPECTATIONS = Object.freeze([
  {
    modulePath: "../server/modules/ai/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/api/index.js",
    requiredExports: {
      buildRoutes: "function"
    }
  },
  {
    modulePath: "../server/modules/auth/index.js",
    requiredExports: {
      createService: "function"
    }
  },
  {
    modulePath: "../server/modules/alerts/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      schema: "object",
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/billing/index.js",
    requiredExports: {
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/chat/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      createService: "function",
      createRepository: "function"
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
      schema: "object",
      createService: "function"
    }
  },
  {
    modulePath: "../server/modules/health/index.js",
    requiredExports: {
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/history/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      schema: "object",
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/projects/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      schema: "object",
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/settings/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      createService: "function",
      createRepository: "function"
    }
  },
  {
    modulePath: "../server/modules/social/index.js",
    requiredExports: {
      createController: "function",
      buildRoutes: "function",
      createService: "function",
      createRepository: "function"
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
]);

const SERVICE_FACTORY_EXPECTATIONS = Object.freeze([
  {
    modulePath: "../server/modules/ai/index.js",
    expectedKeys: ["aiService", "aiTranscriptsService"],
    options: {
      aiService: {},
      aiTranscriptsService: {}
    }
  },
  {
    modulePath: "../server/modules/alerts/index.js",
    expectedKeys: ["service"],
    options: {
      alertsRepository: {}
    }
  },
  {
    modulePath: "../server/modules/auth/index.js",
    expectedKeys: ["accountFlowsService", "oauthFlowsService", "passwordSecurityService"],
    options: {}
  },
  {
    modulePath: "../server/modules/billing/index.js",
    expectedKeys: ["billingProvidersService"],
    options: {
      defaultProvider: "stripe"
    }
  },
  {
    modulePath: "../server/modules/chat/index.js",
    expectedKeys: ["chatService", "chatRealtimeService"],
    options: {
      chatService: {},
      chatRealtimeService: {}
    }
  },
  {
    modulePath: "../server/modules/communications/index.js",
    expectedKeys: ["service"],
    options: {
      smsService: {
        async sendSms() {}
      },
      emailService: {
        async sendEmail() {}
      }
    }
  },
  {
    modulePath: "../server/modules/deg2rad/index.js",
    expectedKeys: ["service"],
    options: {}
  },
  {
    modulePath: "../server/modules/health/index.js",
    expectedKeys: ["service"],
    options: {
      healthRepository: {
        async checkDatabase() {}
      }
    }
  },
  {
    modulePath: "../server/modules/history/index.js",
    expectedKeys: ["service"],
    options: {
      calculationLogsRepository: {
        async insert() {},
        async countForWorkspaceUser() {
          return 0;
        },
        async listForWorkspaceUser() {
          return [];
        },
        async countForWorkspace() {
          return 0;
        },
        async listForWorkspace() {
          return [];
        }
      }
    }
  },
  {
    modulePath: "../server/modules/projects/index.js",
    expectedKeys: ["service"],
    options: {
      projectsRepository: {}
    }
  },
  {
    modulePath: "../server/modules/settings/index.js",
    expectedKeys: ["service"],
    options: {
      userSettingsRepository: {},
      chatUserSettingsRepository: {
        async ensureForUserId() {
          return {};
        },
        async updateByUserId() {
          return {};
        }
      },
      userProfilesRepository: {},
      authService: {
        getSettingsProfileAuthInfo() {
          return {
            emailManagedBy: "supabase",
            emailChangeFlow: "supabase"
          };
        }
      },
      userAvatarService: {
        buildAvatarResponse() {
          return null;
        }
      }
    }
  },
  {
    modulePath: "../server/modules/social/index.js",
    expectedKeys: ["socialService"],
    options: {
      socialService: {}
    }
  }
]);

const REPOSITORY_FACTORY_EXPECTATIONS = Object.freeze([
  {
    modulePath: "../server/modules/alerts/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/ai/index.js",
    expectedKeys: ["conversationsRepository", "messagesRepository"]
  },
  {
    modulePath: "../server/modules/billing/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/chat/index.js",
    expectedKeys: [
      "threadsRepository",
      "participantsRepository",
      "messagesRepository",
      "idempotencyTombstonesRepository",
      "attachmentsRepository",
      "reactionsRepository",
      "userSettingsRepository",
      "blocksRepository"
    ]
  },
  {
    modulePath: "../server/modules/health/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/history/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/projects/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/settings/index.js",
    expectedKeys: ["repository"]
  },
  {
    modulePath: "../server/modules/social/index.js",
    expectedKeys: ["repository"]
  }
]);

test("server module indexes expose exact V2 seams", async () => {
  for (const expectation of MODULE_EXPORT_EXPECTATIONS) {
    const mod = await loadExports(expectation.modulePath);
    assertNoDefaultExport(expectation.modulePath, mod);
    assertExactExportContract(expectation.modulePath, mod, expectation.requiredExports);
    assertRequiredExports(expectation.modulePath, mod, expectation.requiredExports);
  }
});

test("createService seams return exact keyed object contracts", async () => {
  for (const expectation of SERVICE_FACTORY_EXPECTATIONS) {
    const mod = await loadExports(expectation.modulePath);
    const value = mod.createService(expectation.options);
    assertKeyedObjectContract(`${expectation.modulePath}.createService()`, value, expectation.expectedKeys);
  }
});

test("createRepository seams return exact keyed object contracts", async () => {
  for (const expectation of REPOSITORY_FACTORY_EXPECTATIONS) {
    const mod = await loadExports(expectation.modulePath);
    const value = mod.createRepository();
    assertKeyedObjectContract(`${expectation.modulePath}.createRepository()`, value, expectation.expectedKeys);
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
    "@jskit-ai/web-runtime-core/apiClients/authApi",
    "@jskit-ai/web-runtime-core/apiClients/alertsApi",
    "@jskit-ai/web-runtime-core/apiClients/billingApi",
    "../src/modules/deg2rad/api.js",
    "@jskit-ai/web-runtime-core/apiClients/workspaceApi",
    "@jskit-ai/web-runtime-core/apiClients/consoleApi",
    "../src/modules/projects/api.js",
    "@jskit-ai/web-runtime-core/apiClients/settingsApi",
    "@jskit-ai/web-runtime-core/apiClients/historyApi"
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
    "../src/app/router/routes/assistantRoutes.js",
    "../src/app/router/routes/coreRoutes.js",
    "../src/app/router/routes/workspaceRoutes.js",
    "../src/app/router/routes/projectsRoutes.js"
  ];

  for (const modulePath of modules) {
    const mod = await loadExports(modulePath);
    const exportKeys = Object.keys(mod);
    assert.equal(typeof mod.createRoutes, "function", `${modulePath} missing createRoutes`);
    assertNoLegacyFactoryNames(exportKeys, "createRoutes");
  }
});
