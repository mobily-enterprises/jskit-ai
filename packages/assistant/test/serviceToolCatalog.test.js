import test from "node:test";
import assert from "node:assert/strict";
import { createContainer } from "@jskit-ai/kernel/server/container";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { createServiceSchemaCatalog, installServiceRegistrationApi } from "@jskit-ai/kernel/server/runtime";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";

function createApp() {
  const app = createContainer();
  app.singleton("domainEvents", () => ({
    async publish() {
      return null;
    }
  }));
  installServiceRegistrationApi(app);
  app.singleton(KERNEL_TOKENS.ServiceSchemaCatalog, (scope) => createServiceSchemaCatalog(scope));
  return app;
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

  assert.equal(factoryCalls, 1);

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
      },
      schemas: {
        updateRecord: {
          description: "Update profile display name.",
          input: {
            schema: inputSchema
          },
          output: {
            schema: outputSchema
          }
        }
      }
    }
  );

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
      },
      schemas: {
        withSchema: {
          input: {
            schema: {
              type: "object",
              properties: {
                args: {
                  type: "array",
                  minItems: 0,
                  maxItems: 0
                }
              },
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
          }
        }
      }
    }
  );

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
