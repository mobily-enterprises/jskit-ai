import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { createContainer } from "@jskit-ai/kernel/server/container";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
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

test("service tool catalog hides methods user cannot execute", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.customers.service",
    () => ({
      listRecords() {
        return [];
      },
      deleteRecord() {
        return { ok: true };
      }
    })
  );

  app.actions([
    {
      id: "demo.customers.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      inputValidator: {
        schema: { type: "object", additionalProperties: true }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.customers.list"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.customersService.listRecords(input);
      }
    },
    {
      id: "demo.customers.delete",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "all",
        permissions: ["customers.delete"]
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      inputValidator: {
        schema: { type: "object", additionalProperties: true }
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.customers.delete"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.customersService.deleteRecord(input);
      }
    }
  ]);

  const internalContext = {
    channel: "internal",
    surface: "admin"
  };

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });

  const unauthenticatedTools = catalog.resolveToolSet({
    ...internalContext,
    permissions: []
  }).tools;
  assert.equal(unauthenticatedTools.length, 0);

  const authenticatedTools = catalog.resolveToolSet({
    ...internalContext,
    actor: { id: 9 },
    permissions: []
  }).tools;
  assert.equal(authenticatedTools.length, 1);
  assert.equal(authenticatedTools[0].methodName, "listRecords");

  const privilegedTools = catalog.resolveToolSet({
    ...internalContext,
    actor: { id: 9 },
    permissions: ["customers.delete"]
  }).tools;
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
    })
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
    })
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
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);
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
    }
  );

  app.actions([
    {
      id: "demo.cached.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        cachedService: "demo.cached.service"
      },
      inputValidator: {
        schema: { type: "object", additionalProperties: true }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.cached.list"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.cachedService.listRecords(input);
      }
    }
  ]);

  const internalContext = {
    channel: "internal",
    surface: "admin"
  };

  const catalog = createServiceToolCatalog(app, {
    skipServicePrefixes: []
  });

  assert.equal(factoryCalls, 0);

  catalog.resolveToolSet({
    ...internalContext,
    permissions: []
  });
  catalog.resolveToolSet({
    ...internalContext,
    actor: { id: 1 },
    permissions: []
  });
  catalog.resolveToolSet({
    ...internalContext,
    actor: { id: 2 },
    permissions: ["demo.read"]
  });

  assert.equal(factoryCalls, 1);
});

test("service tool catalog uses action-backed schemas for tool contracts", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

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
    })
  );

  app.actions([
    {
      id: "demo.schemas.update",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        schemasService: "demo.schemas.service"
      },
      inputValidator: {
        schema: inputSchema
      },
      outputValidator: {
        schema: outputSchema
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.schemas.update"
      },
      observability: {},
      assistantTool: {
        description: "Update profile display name."
      },
      async execute(input, _context, deps) {
        return deps.schemasService.updateRecord(input);
      }
    }
  ]);

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
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

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
    })
  );

  app.actions([
    {
      id: "demo.strict.with_schema",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        strictService: "demo.strict.service"
      },
      inputValidator: {
        schema: {
          type: "object",
          additionalProperties: false
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            ok: {
              type: "boolean"
            }
          },
          required: ["ok"],
          additionalProperties: false
        }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.strict.with_schema"
      },
      observability: {},
      async execute(_input, _context, deps) {
        return deps.strictService.withSchema();
      }
    }
  ]);

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
    })
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
      permission: {
        require: "authenticated"
      },
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

test("service tool catalog derives input schema from array action validators", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.array_schema.service",
    () => ({
      createRecord(payload = {}) {
        return {
          id: 1,
          ...payload
        };
      }
    })
  );

  app.actions([
    {
      id: "demo.array_schema.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        arraySchemaService: "demo.array_schema.service"
      },
      inputValidator: [
        {
          schema: Type.Object(
            {
              workspaceSlug: Type.String({ minLength: 1 })
            },
            { additionalProperties: false }
          )
        },
        {
          schema: Type.Object(
            {
              name: Type.String({ minLength: 1 }),
              surname: Type.String({ minLength: 1 })
            },
            { additionalProperties: false }
          )
        }
      ],
      outputValidator: {
        schema: Type.Object(
          {
            id: Type.Integer()
          },
          { additionalProperties: true }
        )
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.array_schema.create"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.arraySchemaService.createRecord(input);
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
    permissions: [],
    channel: "internal",
    surface: "admin"
  });
  const createTool = toolSet.tools.find((tool) => tool.serviceToken === "demo.array_schema.service" && tool.methodName === "createRecord");

  assert.ok(createTool);
  assert.equal(createTool.parameters?.type, "object");
  assert.equal(typeof createTool.parameters?.properties?.workspaceSlug, "object");
  assert.equal(typeof createTool.parameters?.properties?.name, "object");
  assert.equal(typeof createTool.parameters?.properties?.surname, "object");
});

test("service tool catalog hides workspaceSlug parameter when workspace context is already resolved", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.workspace_scope.service",
    () => ({
      createRecord(payload = {}) {
        return payload;
      }
    })
  );

  app.actions([
    {
      id: "demo.workspace_scope.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        workspaceScopeService: "demo.workspace_scope.service"
      },
      inputValidator: {
        schema: Type.Object(
          {
            workspaceSlug: Type.String({ minLength: 1 }),
            name: Type.String({ minLength: 1 })
          },
          { additionalProperties: false }
        )
      },
      outputValidator: {
        schema: Type.Object(
          {
            workspaceSlug: Type.String({ minLength: 1 }),
            name: Type.String({ minLength: 1 })
          },
          { additionalProperties: false }
        )
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.workspace_scope.create"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.workspaceScopeService.createRecord(input);
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
    permissions: [],
    channel: "internal",
    surface: "admin",
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          slug: "tonymobily3"
        }
      }
    }
  });
  const createTool = toolSet.tools.find(
    (tool) => tool.serviceToken === "demo.workspace_scope.service" && tool.methodName === "createRecord"
  );

  assert.ok(createTool);
  assert.equal(Object.hasOwn(createTool.parameters.properties, "workspaceSlug"), false);
  assert.equal(typeof createTool.parameters.properties.name, "object");
});

test("service tool catalog injects workspaceSlug from requestMeta request params", async () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.workspace_injection.service",
    () => ({
      createRecord(payload = {}) {
        return payload;
      }
    })
  );

  app.actions([
    {
      id: "demo.workspace_injection.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      dependencies: {
        workspaceInjectionService: "demo.workspace_injection.service"
      },
      inputValidator: {
        schema: Type.Object(
          {
            workspaceSlug: Type.String({ minLength: 1 }),
            name: Type.String({ minLength: 1 })
          },
          { additionalProperties: false }
        )
      },
      outputValidator: {
        schema: Type.Object(
          {
            workspaceSlug: Type.String({ minLength: 1 }),
            name: Type.String({ minLength: 1 })
          },
          { additionalProperties: false }
        )
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.workspace_injection.create"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.workspaceInjectionService.createRecord(input);
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
    surface: "admin",
    requestMeta: {
      request: {
        input: {
          params: {
            workspaceSlug: "tonymobily3"
          }
        }
      }
    }
  };
  const toolSet = catalog.resolveToolSet(context);
  const createTool = toolSet.tools.find(
    (tool) => tool.serviceToken === "demo.workspace_injection.service" && tool.methodName === "createRecord"
  );
  assert.ok(createTool);

  const execution = await catalog.executeToolCall({
    toolName: createTool.name,
    argumentsText: JSON.stringify({
      name: "Merc"
    }),
    context,
    toolSet
  });

  assert.equal(execution.ok, true);
  assert.deepEqual(execution.result, {
    workspaceSlug: "tonymobily3",
    name: "Merc"
  });
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
    })
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
      permission: {
        require: "authenticated"
      },
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
