import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";

function schema(fields = {}, mode = "patch") {
  return { schema: createSchema(fields), mode };
}

function createActions(definitions = []) {
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "test.tools",
    domain: "demo",
    actions: definitions
  });
  return actions;
}

function action({
  id = "demo.books.list",
  version = 1,
  kind = "query",
  channels = ["automation"],
  surfaces = ["admin"],
  permission = { require: "authenticated" },
  input = schema({}),
  output = schema({ ok: { type: "boolean", required: true } }),
  extensions = {},
  execute = async () => ({ ok: true })
} = {}) {
  return {
    id,
    version,
    kind,
    channels,
    surfaces,
    permission,
    input,
    output,
    idempotency: "none",
    extensions,
    execute
  };
}

test("assistant tools expose only automation actions allowed for the actor and surface", () => {
  const actions = createActions([
    action(),
    action({
      id: "demo.books.delete",
      permission: { require: "all", permissions: ["books.delete"] }
    }),
    action({ id: "demo.books.internal", channels: ["internal"] }),
    action({ id: "demo.books.other", surfaces: ["app"] })
  ]);
  const catalog = createServiceToolCatalog(actions);

  assert.equal(catalog.resolveToolSet({ surface: "admin" }).tools.length, 0);
  assert.deepEqual(
    catalog.resolveToolSet({ actor: { id: "7" }, surface: "admin" }).tools.map((entry) => entry.actionId),
    ["demo.books.list"]
  );
  assert.deepEqual(
    catalog.resolveToolSet({
      actor: { id: "7" },
      permissions: ["books.delete"],
      surface: "admin"
    }).tools.map((entry) => entry.actionId),
    ["demo.books.delete", "demo.books.list"]
  );
});

test("assistant tools honor barred ids, prefixes, schemas, and explicit descriptions", () => {
  const actions = createActions([
    action({
      id: "demo.books.list",
      input: schema({ search: { type: "string", required: false } }),
      extensions: { assistant: { description: "Search the catalogue." } }
    }),
    action({ id: "demo.books.delete" }),
    action({ id: "system.health.read" })
  ]);
  const catalog = createServiceToolCatalog(actions, {
    barredActionIds: ["demo.books.delete"],
    skipActionPrefixes: ["system."]
  });
  const [tool] = catalog.resolveToolSet({ actor: { id: "7" }, surface: "admin" }).tools;

  assert.equal(tool.actionId, "demo.books.list");
  assert.equal(tool.description, "Search the catalogue.");
  assert.equal(tool.parameters.properties.search.type, "string");
  assert.equal(tool.outputSchema.properties.ok["x-json-rest-schema"].castType, "boolean");
  assert.equal(catalog.toOpenAiToolSchema(tool).function.name, tool.name);
});

test("assistant tools require complete action or explicit assistant contracts", () => {
  const actions = createActions([
    action({ id: "demo.complete" }),
    action({ id: "demo.no-output", output: null }),
    action({
      id: "demo.assistant-output",
      output: null,
      extensions: {
        assistant: {
          output: schema({ ok: { type: "boolean", required: true } }, "replace")
        }
      }
    })
  ]);
  const tools = createServiceToolCatalog(actions)
    .resolveToolSet({ actor: { id: "7" }, surface: "admin" })
    .tools;

  assert.deepEqual(tools.map((entry) => entry.actionId), ["demo.assistant-output", "demo.complete"]);
});

test("assistant-specific result transforms are validated against their explicit contract", async () => {
  const actions = createActions([action({
    id: "demo.books.transformed",
    output: null,
    extensions: {
      assistant: {
        output: schema({
          id: { type: "string", required: true },
          title: { type: "string", required: true }
        }, "replace"),
        transformResult(result) {
          return {
            id: result.data.id,
            title: result.data.attributes.title
          };
        }
      }
    },
    execute: async () => ({
      data: {
        id: "42",
        attributes: { title: "Kindred" }
      }
    })
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);

  assert.equal(toolSet.tools[0].outputSchema.properties.title.type, "string");
  assert.deepEqual(await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    context,
    toolSet
  }), {
    ok: true,
    result: { id: "42", title: "Kindred" }
  });

  const invalidCatalog = createServiceToolCatalog(createActions([action({
    id: "demo.books.invalid-transform",
    output: null,
    extensions: {
      assistant: {
        output: schema({ title: { type: "string", required: true } }, "replace"),
        transformResult() {
          return {};
        }
      }
    }
  })]));
  const invalidToolSet = invalidCatalog.resolveToolSet(context);
  assert.deepEqual(await invalidCatalog.executeToolCall({
    toolName: invalidToolSet.tools[0].name,
    context,
    toolSet: invalidToolSet
  }), {
    ok: false,
    error: {
      code: "assistant_tool_output_invalid",
      message: "Tool call failed.",
      status: 500
    }
  });
});

test("assistant tools hide workspaceSlug and overwrite model values with trusted workspace context", async () => {
  let executed = null;
  const actions = createActions([action({
    input: schema({
      workspaceSlug: { type: "string", required: true },
      title: { type: "string", required: true }
    }),
    execute: async (input, context) => {
      executed = { input, context };
      return { ok: true };
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = {
    actor: { id: "7" },
    surface: "admin",
    workspace: { slug: "library" }
  };
  const toolSet = catalog.resolveToolSet(context);

  assert.equal(Object.hasOwn(toolSet.tools[0].parameters.properties, "workspaceSlug"), false);
  const response = await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    argumentsText: JSON.stringify({ workspaceSlug: "other", title: "Kindred" }),
    context,
    toolSet
  });

  assert.deepEqual(response, { ok: true, result: { ok: true } });
  assert.deepEqual(executed.input, { workspaceSlug: "library", title: "Kindred" });
  assert.equal(executed.context.channel, "automation");
});

test("assistant tools expose safe field-level input guidance to the model", async () => {
  const actions = createActions([action({
    input: schema({
      include: {
        type: "string",
        required: false,
        messages: {
          default: "include expects a comma-separated string such as \"pet,service\"."
        }
      }
    })
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);

  assert.deepEqual(await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    argumentsText: JSON.stringify({ include: ["pet"] }),
    context,
    toolSet
  }), {
    ok: false,
    error: {
      code: "ACTION_VALIDATION_FAILED",
      message: "Validation failed. include: include expects a comma-separated string such as \"pet,service\".",
      status: 400
    }
  });
});

test("large authorized catalogs use compact paged discovery, exact contracts, and gated execution", async () => {
  const executions = [];
  const workspaceInput = schema({
    workspaceSlug: { type: "string", required: true },
    q: { type: "string", required: false }
  });
  const definitions = [
    action({
      id: "demo.books.list",
      input: workspaceInput,
      execute: async (input, context) => {
        executions.push({ input, context });
        return { ok: true };
      }
    }),
    action({ id: "demo.books.view", input: workspaceInput }),
    action({
      id: "demo.books.delete",
      permission: { require: "all", permissions: ["books.delete"] }
    }),
    action({ id: "demo.books.other-surface", surfaces: ["app"] }),
    action({ id: "demo.books.internal", channels: ["internal"] })
  ];
  const catalog = createServiceToolCatalog(createActions(definitions), {
    maxDirectTools: 1,
    discoveryPageSize: 1
  });
  const context = {
    actor: { id: "7" },
    surface: "admin",
    workspace: { slug: "library" }
  };
  const toolSet = catalog.resolveToolSet(context);

  assert.deepEqual(toolSet.tools.map((entry) => entry.name), [
    "assistant_action_search",
    "assistant_action_contract",
    "assistant_action_execute"
  ]);

  const firstPage = await catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ query: "books", limit: 1 }),
    context,
    toolSet
  });
  assert.equal(firstPage.ok, true);
  assert.equal(firstPage.result.total, 2);
  assert.equal(firstPage.result.items.length, 1);
  assert.equal(Object.hasOwn(firstPage.result.items[0], "inputSchema"), false);
  assert.equal(typeof firstPage.result.nextCursor, "string");

  const secondPage = await catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({
      query: "books",
      cursor: firstPage.result.nextCursor,
      limit: 1
    }),
    context,
    toolSet
  });
  assert.equal(secondPage.result.items.length, 1);
  assert.equal(secondPage.result.nextCursor, null);

  assert.deepEqual(await catalog.executeToolCall({
    toolName: "assistant_action_contract",
    argumentsText: JSON.stringify({ actionId: "demo.books.delete" }),
    context,
    toolSet
  }), {
    ok: false,
    error: {
      code: "assistant_action_unknown",
      message: "Action is not available.",
      status: 404
    }
  });

  assert.deepEqual(await catalog.executeToolCall({
    toolName: "assistant_action_execute",
    argumentsText: JSON.stringify({
      actionId: "demo.books.list",
      version: 1,
      input: { workspaceSlug: "other", q: "octavia" }
    }),
    context,
    toolSet
  }), {
    ok: false,
    error: {
      code: "assistant_action_contract_required",
      message: "Load this action's exact contract before executing it.",
      status: 409
    }
  });

  const contract = await catalog.executeToolCall({
    toolName: "assistant_action_contract",
    argumentsText: JSON.stringify({ actionId: "demo.books.list", version: 1 }),
    context,
    toolSet
  });
  assert.equal(contract.ok, true);
  assert.equal(contract.result.actionId, "demo.books.list");
  assert.equal(Object.hasOwn(contract.result.inputSchema.properties, "workspaceSlug"), false);
  assert.equal(contract.result.outputSchema.properties.ok["x-json-rest-schema"].castType, "boolean");

  assert.deepEqual(await catalog.executeToolCall({
    toolName: "assistant_action_execute",
    argumentsText: JSON.stringify({
      actionId: "demo.books.list",
      version: 1,
      input: { workspaceSlug: "other", q: "octavia" }
    }),
    context,
    toolSet
  }), {
    ok: true,
    result: {
      actionId: "demo.books.list",
      version: 1,
      result: { ok: true }
    }
  });
  assert.deepEqual(executions[0].input, {
    workspaceSlug: "library",
    q: "octavia"
  });
  assert.equal(executions[0].context.channel, "automation");
});

test("discovery pages and persisted tool results stay within configured bounds", async () => {
  const definitions = Array.from({ length: 25 }, (_, index) => action({
    id: `demo.items.action-${String(index + 1).padStart(2, "0")}`
  }));
  const discoveryCatalog = createServiceToolCatalog(createActions(definitions), {
    maxDirectTools: 1
  });
  const context = { actor: { id: "7" }, surface: "admin" };
  const discoveryToolSet = discoveryCatalog.resolveToolSet(context);
  const page = await discoveryCatalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ limit: 100 }),
    context,
    toolSet: discoveryToolSet
  });
  assert.equal(page.ok, true);
  assert.equal(page.result.items.length, 20);
  assert.equal(typeof page.result.nextCursor, "string");

  const largeContractFields = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [
      `field${index}`,
      { type: "string", required: false, description: "x".repeat(40) }
    ])
  );
  const contractCatalog = createServiceToolCatalog(createActions([action({
    id: "demo.large.contract",
    input: schema(largeContractFields)
  })]), {
    maxDirectTools: 0,
    maxToolResultBytes: 500
  });
  const contractToolSet = contractCatalog.resolveToolSet(context);
  assert.deepEqual(await contractCatalog.executeToolCall({
    toolName: "assistant_action_contract",
    argumentsText: JSON.stringify({ actionId: "demo.large.contract" }),
    context,
    toolSet: contractToolSet
  }), {
    ok: false,
    error: {
      code: "assistant_tool_contract_too_large",
      message: "Action contract exceeds the assistant size limit. Narrow the request and try again.",
      status: 413
    }
  });

  const resultCatalog = createServiceToolCatalog(createActions([action({
    id: "demo.large.read",
    output: schema({ value: { type: "string", required: true } }, "replace"),
    execute: async () => ({ value: "x".repeat(1000) })
  })]), {
    maxToolResultBytes: 200
  });
  const resultToolSet = resultCatalog.resolveToolSet(context);
  assert.deepEqual(await resultCatalog.executeToolCall({
    toolName: resultToolSet.tools[0].name,
    context,
    toolSet: resultToolSet
  }), {
    ok: false,
    error: {
      code: "assistant_tool_result_too_large",
      message: "Tool result exceeds the assistant size limit. Narrow the request and try again.",
      status: 413
    }
  });
});

test("assistant tools reject unknown tools and return safe action failures", async () => {
  const actions = createActions([action({
    execute: async () => {
      const error = new Error("Database exploded with secret detail.");
      error.statusCode = 500;
      error.code = "DATABASE_FAILED";
      throw error;
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);

  assert.deepEqual(await catalog.executeToolCall({ toolName: "missing", context, toolSet }), {
    ok: false,
    error: { code: "assistant_tool_unknown", message: "Unknown tool." }
  });
  assert.deepEqual(await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    context,
    toolSet
  }), {
    ok: false,
    error: { code: "DATABASE_FAILED", message: "Tool call failed.", status: 500 }
  });
});
