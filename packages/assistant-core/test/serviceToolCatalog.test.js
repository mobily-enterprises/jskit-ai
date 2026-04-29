import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { createContainer } from "@jskit-ai/kernel/_testable";
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      input: {
        schema: { type: "object", additionalProperties: true }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        }
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "all",
        permissions: ["customers.delete"]
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      input: {
        schema: { type: "object", additionalProperties: true }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: true
        }
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
    skipActionPrefixes: []
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
  assert.equal(authenticatedTools[0].actionId, "demo.customers.list");

  const privilegedTools = catalog.resolveToolSet({
    ...internalContext,
    actor: { id: 9 },
    permissions: ["customers.delete"]
  }).tools;
  assert.equal(privilegedTools.length, 2);
});

test("service tool catalog does not expose non-action-backed service methods", async () => {
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
    skipActionPrefixes: []
  });

  const context = {
    actor: {
      id: 22
    },
    permissions: []
  };
  const toolSet = catalog.resolveToolSet(context);
  assert.equal(toolSet.tools.length, 0);

  const execution = await catalog.executeToolCall({
    toolName: "demo_profile_service_updateprofile",
    argumentsText: JSON.stringify({
      args: [{ displayName: "Merc" }],
      options: {
        source: "assistant"
      }
    }),
    context,
    toolSet
  });

  assert.equal(execution.ok, false);
  assert.deepEqual(execution.error, {
    code: "assistant_tool_unknown",
    message: "Unknown tool."
  });
});

test("service tool catalog hides actions that are not automation-enabled", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.non_automation.service",
    () => ({
      listRecords() {
        return [];
      }
    })
  );

  app.actions([
    {
      id: "demo.non_automation.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        nonAutomationService: "demo.non_automation.service"
      },
      input: {
        schema: createSchema({})
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.non_automation.list"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.nonAutomationService.listRecords(input);
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: [],
    channel: "internal",
    surface: "admin"
  });

  assert.equal(toolSet.tools.length, 0);
});

test("service tool catalog honors barred action ids", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.audit.service",
    () => ({
      listEntries() {
        return [];
      }
    })
  );

  app.actions([
    {
      id: "demo.audit.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        auditService: "demo.audit.service"
      },
      input: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.audit.list"
      },
      observability: {},
      async execute(input, _context, deps) {
        return deps.auditService.listEntries(input);
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: [],
    barredActionIds: ["demo.audit.list"]
  });

  const toolSet = catalog.resolveToolSet({ actor: { id: 1 }, permissions: [], channel: "internal", surface: "admin" });
  assert.equal(toolSet.tools.length, 0);
});

test("service tool catalog materializes action tools once and filters per request", () => {
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        cachedService: "demo.cached.service"
      },
      input: {
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
    skipActionPrefixes: []
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        schemasService: "demo.schemas.service"
      },
      input: {
        schema: inputSchema
      },
      output: {
        schema: outputSchema
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.schemas.update"
      },
      observability: {},
      extensions: {
        assistant: {
          description: "Update profile display name."
        }
      },
      async execute(input, _context, deps) {
        return deps.schemasService.updateRecord(input);
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: []
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

test("service tool catalog rejects legacy assistantTool field at assistant layer", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.legacy_assistant.service",
    () => ({
      createLegacy(input = {}) {
        return {
          ok: Boolean(input)
        };
      },
      createModern(input = {}) {
        return {
          ok: Boolean(input)
        };
      }
    })
  );

  const schema = Object.freeze({
    type: "object",
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

  app.actions([
    {
      id: "demo.legacy_assistant.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        legacyAssistantService: "demo.legacy_assistant.service"
      },
      input: {
        schema
      },
      output: {
        schema: outputSchema
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.legacy_assistant.create"
      },
      observability: {},
      assistantTool: {
        description: "Legacy assistant tool metadata."
      },
      async execute(input, _context, deps) {
        return deps.legacyAssistantService.createLegacy(input);
      }
    },
    {
      id: "demo.modern_assistant.create",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        legacyAssistantService: "demo.legacy_assistant.service"
      },
      input: {
        schema
      },
      output: {
        schema: outputSchema
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.modern_assistant.create"
      },
      observability: {},
      extensions: {
        assistant: {
          description: "Modern assistant extension metadata."
        }
      },
      async execute(input, _context, deps) {
        return deps.legacyAssistantService.createModern(input);
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: []
  });
  const actionIds = toolSet.tools.map((tool) => tool.actionId).sort();

  assert.deepEqual(actionIds, ["demo.modern_assistant.create"]);
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        strictService: "demo.strict.service"
      },
      input: {
        schema: {
          type: "object",
          additionalProperties: false
        }
      },
      output: {
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
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: []
  });

  assert.equal(toolSet.tools.length, 1);
  assert.equal(toolSet.tools[0].actionId, "demo.strict.with_schema");
});

test("service tool catalog derives tool schemas from action contributors", () => {
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      input: {
        schema: inputSchema
      },
      output: {
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
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: {
      id: 1
    },
    permissions: []
  });
  const createTool = toolSet.tools.find((tool) => tool.actionId === "demo.customers.create");

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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        arraySchemaService: "demo.array_schema.service"
      },
      input: [
        {
          schema: createSchema({
            workspaceSlug: {
              type: "string",
              required: true,
              minLength: 1
            }
          })
        },
        {
          schema: createSchema({
            name: {
              type: "string",
              required: true,
              minLength: 1
            },
            surname: {
              type: "string",
              required: true,
              minLength: 1
            }
          })
        }
      ],
      output: {
        schema: createSchema({
          id: {
            type: "integer",
            required: true
          },
          payload: {
            type: "object",
            required: true
          }
        })
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
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: {
      id: 1
    },
    permissions: [],
    channel: "internal",
    surface: "admin"
  });
  const createTool = toolSet.tools.find((tool) => tool.actionId === "demo.array_schema.create");

  assert.ok(createTool);
  assert.equal(createTool.parameters?.type, "object");
  assert.equal(typeof createTool.parameters?.properties?.workspaceSlug, "object");
  assert.equal(typeof createTool.parameters?.properties?.name, "object");
  assert.equal(typeof createTool.parameters?.properties?.surname, "object");
});

test("service tool catalog preserves section-map validators in tool schemas", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.service(
    "demo.workspace_settings.service",
    () => ({
      updateSettings(input = {}) {
        return input;
      }
    })
  );

  const patchValidator = Object.freeze({
    schema: createSchema({
      name: {
        type: "string",
        required: true,
        minLength: 1
      }
    })
  });

  app.actions([
    {
      id: "demo.workspace.settings.update",
      domain: "demo",
      version: 1,
      kind: "command",
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        workspaceSettingsService: "demo.workspace_settings.service"
      },
      input: [
        {
          schema: createSchema({
            workspaceSlug: {
              type: "string",
              required: true,
              minLength: 1
            }
          })
        },
        {
          patch: patchValidator
        }
      ],
      output: {
        schema: createSchema({
          ok: {
            type: "boolean",
            required: true
          }
        })
      },
      idempotency: "optional",
      audit: {
        actionName: "demo.workspace.settings.update"
      },
      observability: {},
      extensions: {
        assistant: {}
      },
      async execute(input, _context, deps) {
        const result = deps.workspaceSettingsService.updateSettings(input);
        return {
          ok: Boolean(result)
        };
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: []
  });
  const toolSet = catalog.resolveToolSet({
    actor: { id: 1 },
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
  const updateTool = toolSet.tools.find((tool) => tool.actionId === "demo.workspace.settings.update");

  assert.ok(updateTool);
  assert.equal(updateTool.parameters?.type, "object");
  assert.equal(Object.hasOwn(updateTool.parameters?.properties || {}, "workspaceSlug"), false);
  assert.equal(typeof updateTool.parameters?.properties?.patch, "object");
  assert.equal(updateTool.parameters?.properties?.patch.type, "object");
  assert.equal(typeof updateTool.parameters?.properties?.patch.properties?.name, "object");
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        workspaceScopeService: "demo.workspace_scope.service"
      },
      input: {
        schema: createSchema({
          workspaceSlug: {
            type: "string",
            required: true,
            minLength: 1
          },
          name: {
            type: "string",
            required: true,
            minLength: 1
          }
        })
      },
      output: {
        schema: createSchema({
          workspaceSlug: {
            type: "string",
            required: true,
            minLength: 1
          },
          name: {
            type: "string",
            required: true,
            minLength: 1
          }
        })
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
    skipActionPrefixes: []
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
    (tool) => tool.actionId === "demo.workspace_scope.create"
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        workspaceInjectionService: "demo.workspace_injection.service"
      },
      input: {
        schema: createSchema({
          workspaceSlug: {
            type: "string",
            required: true,
            minLength: 1
          },
          name: {
            type: "string",
            required: true,
            minLength: 1
          }
        })
      },
      output: {
        schema: createSchema({
          workspaceSlug: {
            type: "string",
            required: true,
            minLength: 1
          },
          name: {
            type: "string",
            required: true,
            minLength: 1
          }
        })
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
    skipActionPrefixes: []
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
    (tool) => tool.actionId === "demo.workspace_injection.create"
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
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      dependencies: {
        customersService: "demo.customers.service"
      },
      input: {
        schema: createSchema({
          recordId: {
            type: "integer",
            required: true,
            min: 1
          },
          name: {
            type: "string"
          }
        })
      },
      output: {
        schema: createSchema({
          id: {
            type: "integer",
            required: true
          },
          payload: {
            type: "object",
            required: true
          }
        })
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
    skipActionPrefixes: []
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
  const updateTool = toolSet.tools.find((tool) => tool.actionId === "demo.customers.update");
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

test("service tool catalog hides automation actions from other surfaces", () => {
  const app = createApp();
  const actionRuntimeProvider = new ActionRuntimeServiceProvider();
  actionRuntimeProvider.register(app);

  app.actions([
    {
      id: "demo.admin.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["automation"],
      surfaces: ["admin"],
      permission: {
        require: "authenticated"
      },
      input: {
        schema: createSchema({})
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.admin.list"
      },
      observability: {},
      async execute() {
        return [];
      }
    },
    {
      id: "demo.console.list",
      domain: "demo",
      version: 1,
      kind: "query",
      channels: ["automation"],
      surfaces: ["console"],
      permission: {
        require: "authenticated"
      },
      input: {
        schema: createSchema({})
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        }
      },
      idempotency: "none",
      audit: {
        actionName: "demo.console.list"
      },
      observability: {},
      async execute() {
        return [];
      }
    }
  ]);

  const catalog = createServiceToolCatalog(app, {
    skipActionPrefixes: []
  });

  const adminToolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: [],
    channel: "internal",
    surface: "admin"
  });
  const consoleToolSet = catalog.resolveToolSet({
    actor: { id: 1 },
    permissions: [],
    channel: "internal",
    surface: "console"
  });

  assert.deepEqual(adminToolSet.tools.map((entry) => entry.actionId), ["demo.admin.list"]);
  assert.deepEqual(consoleToolSet.tools.map((entry) => entry.actionId), ["demo.console.list"]);
});
