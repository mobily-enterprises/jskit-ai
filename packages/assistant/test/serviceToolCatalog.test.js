import test from "node:test";
import assert from "node:assert/strict";
import { createContainer } from "@jskit-ai/kernel/server/container";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { installServiceRegistrationApi } from "@jskit-ai/kernel/server/runtime";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";

function createApp() {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);
  return app;
}

function toSchemaCatalogKey(serviceToken, methodName) {
  return `${String(serviceToken || "").trim().toLowerCase()}.${String(methodName || "").trim().toLowerCase()}`;
}

function bindServiceSchemaCatalog(app, entries = []) {
  const normalizedEntries = Array.isArray(entries) ? entries : [entries];
  const byKey = new Map();
  for (const entry of normalizedEntries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const key = toSchemaCatalogKey(entry.serviceToken, entry.methodName);
    if (!key || key === ".") {
      continue;
    }

    byKey.set(key, Object.freeze({
      serviceToken: String(entry.serviceToken || "").trim(),
      methodName: String(entry.methodName || "").trim(),
      key: `${String(entry.serviceToken || "").trim()}.${String(entry.methodName || "").trim()}`,
      description: String(entry.description || "").trim(),
      inputSchema: entry.inputSchema || null,
      outputSchema: entry.outputSchema || null
    }));
  }

  const list = Object.freeze([...byKey.values()]);
  app.singleton(
    KERNEL_TOKENS.ServiceSchemaCatalog,
    () =>
      Object.freeze({
        getServiceMethodSchema(serviceToken, methodName) {
          return byKey.get(toSchemaCatalogKey(serviceToken, methodName)) || null;
        },
        listServiceMethodSchemas() {
          return list;
        }
      })
  );
}

test("service tool catalog hides methods user cannot execute", () => {
  const app = createApp();

  app.service(
    "demo.customers.service",
    () => ({
      listRecords() {
        return [];
      },
      deleteRecord() {
        return { ok: true };
      }
    }),
    {
      permissions: {
        listRecords: {
          require: "authenticated"
        },
        deleteRecord: {
          require: "all",
          permissions: ["customers.delete"]
        }
      }
    }
  );

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });

  const unauthenticatedTools = catalog.resolveToolSet({ permissions: [] }).tools;
  assert.equal(unauthenticatedTools.length, 0);

  const authenticatedTools = catalog.resolveToolSet({ actor: { id: 9 }, permissions: [] }).tools;
  assert.equal(authenticatedTools.length, 1);
  assert.equal(authenticatedTools[0].methodName, "listRecords");

  const privilegedTools = catalog.resolveToolSet({ actor: { id: 9 }, permissions: ["customers.delete"] }).tools;
  assert.equal(privilegedTools.length, 2);
});

test("service tool catalog executes tool call and injects action context", async () => {
  const app = createApp();

  app.service(
    "demo.profile.service",
    () => ({
      updateProfile(patch = {}, options = {}) {
        return {
          patch,
          actorId: Number(options?.context?.actor?.id || 0),
          source: String(options?.source || "")
        };
      }
    }),
    {
      permissions: {
        updateProfile: {
          require: "authenticated"
        }
      }
    }
  );

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });

  const context = {
    actor: {
      id: 22
    },
    permissions: []
  };
  const toolSet = catalog.resolveToolSet(context);
  assert.equal(toolSet.tools.length, 1);

  const execution = await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    argumentsText: JSON.stringify({
      args: [{ displayName: "Merc" }],
      options: {
        source: "assistant"
      }
    }),
    context,
    toolSet
  });

  assert.equal(execution.ok, true);
  assert.deepEqual(execution.result, {
    patch: {
      displayName: "Merc"
    },
    actorId: 22,
    source: "assistant"
  });
});

test("service tool catalog honors barred service methods", () => {
  const app = createApp();

  app.service(
    "demo.audit.service",
    () => ({
      listEntries() {
        return [];
      }
    }),
    {
      permissions: {
        listEntries: {
          require: "authenticated"
        }
      }
    }
  );

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: [],
    barredServiceMethods: ["demo.audit.service.listEntries"]
  });

  const toolSet = catalog.resolveToolSet({ actor: { id: 1 }, permissions: [] });
  assert.equal(toolSet.tools.length, 0);
});

test("service tool catalog materializes service methods once and filters per request", () => {
  const app = createApp();
  let factoryCalls = 0;

  app.service(
    "demo.cached.service",
    () => {
      factoryCalls += 1;
      return {
        listRecords() {
          return [];
        }
      };
    },
    {
      permissions: {
        listRecords: {
          require: "authenticated"
        }
      }
    }
  );

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });

  assert.equal(factoryCalls, 0);

  catalog.resolveToolSet({ permissions: [] });
  catalog.resolveToolSet({ actor: { id: 1 }, permissions: [] });
  catalog.resolveToolSet({ actor: { id: 2 }, permissions: ["demo.read"] });

  assert.equal(factoryCalls, 1);
});

test("service tool catalog uses runtime service schema catalog for tool contracts", () => {
  const app = createApp();

  const inputSchema = Object.freeze({
    type: "object",
    properties: {
      args: {
        type: "array",
        prefixItems: [
          {
            type: "object",
            properties: {
              displayName: {
                type: "string"
              }
            },
            required: ["displayName"],
            additionalProperties: false
          }
        ],
        minItems: 1,
        maxItems: 1
      },
      options: {
        type: "object",
        additionalProperties: true
      }
    },
    additionalProperties: false
  });
  const outputSchema = Object.freeze({
    type: "object",
    properties: {
      ok: {
        type: "boolean"
      }
    },
    required: ["ok"],
    additionalProperties: false
  });

  app.service(
    "demo.schemas.service",
    () => ({
      updateRecord(payload = {}) {
        return {
          ok: Boolean(payload?.displayName)
        };
      }
    }),
    {
      permissions: {
        updateRecord: {
          require: "authenticated"
        }
      }
    }
  );
  bindServiceSchemaCatalog(app, {
    serviceToken: "demo.schemas.service",
    methodName: "updateRecord",
    description: "Update profile display name.",
    inputSchema,
    outputSchema
  });

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: []
  });

  assert.equal(toolSet.tools.length, 1);
  assert.equal(toolSet.tools[0].description, "Update profile display name.");
  assert.equal(toolSet.tools[0].parameters, inputSchema);
  assert.equal(toolSet.tools[0].outputSchema, outputSchema);
});

test("service tool catalog can require input/output schemas for tool exposure", () => {
  const app = createApp();

  app.service(
    "demo.strict.service",
    () => ({
      noSchema() {
        return {
          ok: true
        };
      },
      withSchema() {
        return {
          ok: true
        };
      }
    }),
    {
      permissions: {
        noSchema: {
          require: "authenticated"
        },
        withSchema: {
          require: "authenticated"
        }
      }
    }
  );
  bindServiceSchemaCatalog(app, {
    serviceToken: "demo.strict.service",
    methodName: "withSchema",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          minItems: 0,
          maxItems: 0
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: {
          type: "boolean"
        }
      },
      required: ["ok"],
      additionalProperties: false
    }
  });

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: [],
    requireMethodSchemas: true
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: []
  });

  assert.equal(toolSet.tools.length, 1);
  assert.equal(toolSet.tools[0].methodName, "withSchema");
});

test("service tool catalog derives method schemas from action contributors when catalog is empty", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  const inputSchema = Object.freeze({
    type: "object",
    properties: {
      workspaceSlug: {
        type: "string"
      },
      name: {
        type: "string"
      },
      surname: {
        type: "string"
      }
    },
    additionalProperties: false
  });
  const outputSchema = Object.freeze({
    type: "object",
    properties: {
      id: {
        type: "integer"
      }
    },
    required: ["id"],
    additionalProperties: false
  });

  app.service(
    "demo.customers.service",
    () => ({
      createRecord(payload = {}) {
        return {
          id: 1,
          ...payload
        };
      }
    }),
    {
      permissions: {
        createRecord: {
          require: "authenticated"
        }
      }
    }
  );

  app.actions([
    {
      id: "demo.customers.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      dependencies: {
        customersService: "demo.customers.service"
      },
      inputValidator: {
        schema: inputSchema
      },
      outputValidator: {
        schema: outputSchema
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.customers.create"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.customersService.createRecord(input);
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: {
      id: 1
    },
    permissions: []
  });
  const createTool = toolSet.tools.find((tool) => tool.serviceToken === "demo.customers.service" && tool.methodName === "createRecord");

  assert.ok(createTool);
  assert.equal(createTool.parameters, inputSchema);
  assert.equal(createTool.outputSchema, outputSchema);
});

test("service tool catalog executes action-backed tools with object payloads", async () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.customers.service",
    () => ({
      updateRecord(recordId, payload = {}) {
        return {
          id: Number(recordId),
          payload
        };
      }
    }),
    {
      permissions: {
        updateRecord: {
          require: "authenticated"
        }
      }
    }
  );

  app.actions([
    {
      id: "demo.customers.update",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      dependencies: {
        customersService: "demo.customers.service"
      },
      inputValidator: {
        schema: {
          type: "object",
          properties: {
            recordId: {
              type: "integer",
              minimum: 1
            },
            name: {
              type: "string"
            }
          },
          required: ["recordId"],
          additionalProperties: false
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: {
              type: "integer"
            }
          },
          required: ["id"],
          additionalProperties: true
        }
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.customers.update"
      },
      observability: {},
      async execute(input, context, deps) {
        const { recordId, ...patch } = input;
        return deps.customersService.updateRecord(recordId, patch, {
          context
        });
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });
  const context = {
    actor: {
      id: 1
    },
    permissions: [],
    channel: "internal",
    surface: "admin"
  };
  const toolSet = catalog.resolveToolSet(context);
  const updateTool = toolSet.tools.find((tool) => tool.serviceToken === "demo.customers.service" && tool.methodName === "updateRecord");
  assert.ok(updateTool);

  const execution = await catalog.executeToolCall({
    toolName: updateTool.name,
    argumentsText: JSON.stringify({
      recordId: 7,
      name: "Merc"
    }),
    context,
    toolSet
  });

  assert.equal(execution.ok, true);
  assert.deepEqual(execution.result, {
    id: 7,
    payload: {
      name: "Merc"
    }
  });
});
