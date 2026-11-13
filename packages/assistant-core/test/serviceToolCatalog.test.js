import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionCatalogue, isExecutionLogged } from "@jskit-ai/kernel/server/actions";
import { AppError, createValidationError, DomainValidationError, NotFoundError } from "@jskit-ai/kernel/server/runtime/errors";
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
  checkInput = null,
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
    extensions,
    checkInput,
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

test("application tool policy scopes observations and rechecks retained discovery and execution", async () => {
  const executions = [];
  let commandsAllowed = true;
  const actions = createActions([action(), action({ id: "demo.books.delete", kind: "command",
    execute: async () => { executions.push("delete"); return { ok: true }; } })]);
  const context = { actor: { id: "7" }, surface: "admin" };
  const catalog = createServiceToolCatalog(actions, {
    isActionAvailable: ({ kind, context }) => kind === "query" || (!context.observation && commandsAllowed)
  });
  assert.deepEqual(catalog.resolveToolSet({ ...context, observation: true }).tools.map(tool => tool.actionId), ["demo.books.list"]);
  const direct = catalog.resolveToolSet(context);
  const discovery = catalog.resolveToolSet(context, { discoveryOnly: true });
  const invoke = (toolName, args) => catalog.executeToolCall({ toolSet: discovery, context, toolName, argumentsText: JSON.stringify(args) });
  assert.equal((await invoke("assistant_action_contract", { actionId: "demo.books.delete" })).ok, true);
  commandsAllowed = false;
  assert.deepEqual((await invoke("assistant_action_search", {})).result.items.map(item => item.actionId), ["demo.books.list"]);
  assert.equal((await invoke("assistant_action_contract", { actionId: "demo.books.delete" })).ok, false);
  assert.equal((await invoke("assistant_action_execute", { actionId: "demo.books.delete", input: {} })).ok, false);
  assert.equal((await catalog.executeToolCall({ toolSet: direct, context,
    toolName: direct.tools.find(tool => tool.actionId === "demo.books.delete").name, argumentsText: "{}" })).ok, false);
  assert.deepEqual(executions, []);
  assert.throws(() => createServiceToolCatalog(actions, { isActionAvailable: async () => true }).resolveToolSet(context), /return a boolean/);
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

test("assistant tools give the model the field and the type to use when an action's own input check refuses a key", async () => {
  let executed = false;
  const actions = createActions([action({
    input: schema({ fields: { type: "object", required: false, additionalProperties: true } }),
    // A check of what the schema cannot judge, such as a fieldset key only the application's tables can name.
    checkInput(input) {
      if (input.fields?.pet) {
        throw createValidationError({
          "fields.pet": {
            code: "demo.fieldsKeys",
            params: { type: "pets" },
            message: "fields keys must be resource types. Allowed keys: \"books\", \"pets\"; use \"pets\" instead of \"pet\"."
          }
        });
      }
    },
    execute: async () => {
      executed = true;
      return { ok: true };
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);

  assert.deepEqual(await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    argumentsText: JSON.stringify({ fields: { pet: ["name"] } }),
    context,
    toolSet
  }), {
    ok: false,
    error: {
      code: "ACTION_VALIDATION_FAILED",
      message: "Validation failed. fields.pet: fields keys must be resource types. Allowed keys: \"books\", \"pets\"; " +
        "use \"pets\" instead of \"pet\".",
      status: 400
    }
  });
  assert.equal(executed, false);
});

test("an action's own validation refusal reaches the model with its reason and field errors, as a person sees them", async () => {
  let refusal = null;
  const actions = createActions([action({ kind: "command", execute: async () => { throw refusal; } })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  const call = () => catalog.executeToolCall({ toolName: toolSet.tools[0].name, argumentsText: "{}", context, toolSet });

  // Rules no input schema states, which the action checks against its records as it runs.
  refusal = createValidationError({
    parcels: "The parcel weights add up to 12 kg, not the 15 kg recorded.",
    note: "Add a note when the inspection fails."
  });
  assert.deepEqual(await call(), {
    ok: false,
    error: {
      code: "validation_failed",
      message: "Validation failed. note: Add a note when the inspection fails. " +
        "parcels: The parcel weights add up to 12 kg, not the 15 kg recorded.",
      status: 400
    }
  });

  refusal = new DomainValidationError(
    { fieldErrors: { grade: "A shipment that mixes two sources cannot be graded premium." } },
    { message: "This shipment cannot be graded." }
  );
  assert.deepEqual(await call(), {
    ok: false,
    error: {
      code: "domain_validation_failed",
      message: "This shipment cannot be graded. grade: A shipment that mixes two sources cannot be graded premium.",
      status: 422
    }
  });
});

test("an internal failure, a permission refusal and a not-found refusal stay as generic as before", async () => {
  let failure = null;
  const actions = createActions([
    action({
      kind: "command",
      execute: async (_input, context) => {
        if (failure) throw failure;
        // An action that runs another the caller may not: the action runtime's own permission refusal.
        return actions.execute({ actionId: "demo.books.audit", version: 1, input: {}, context });
      }
    }),
    action({ id: "demo.books.audit", permission: { require: "all", permissions: ["books.audit"] } })
  ]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  const call = () => catalog.executeToolCall({ toolName: "demo_books_list", argumentsText: "{}", context, toolSet });

  const refused = await call();
  assert.deepEqual(refused, { ok: false, error: { code: "ACTION_PERMISSION_DENIED", message: "Forbidden.", status: 403 } });
  assert.equal(JSON.stringify(refused).includes("books.audit"), false, "Never the action or the permission refused");

  failure = new NotFoundError("Not found.", { details: { resourceId: "shipment-4471" } });
  assert.deepEqual(await call(), { ok: false, error: { code: "not_found", message: "Not found.", status: 404 } });

  failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { stack: "Error: at private/database.js:7" });
  assert.deepEqual(await call(), { ok: false, error: { code: "assistant_tool_failed", message: "Tool call failed.", status: 500 } });

  // A server fault stays hidden even when it carries field errors.
  failure = new AppError(500, "Column private_notes is missing.", {
    code: "internal_server_error",
    details: { fieldErrors: { private_notes: "Unknown column." } }
  });
  assert.deepEqual(await call(), { ok: false, error: { code: "internal_server_error", message: "Tool call failed.", status: 500 } });
});

test("large authorized catalogs use compact paged discovery, exact contracts, and gated execution", async () => {
  const executions = [];
  let clockExecution = null;
  const workspaceInput = schema({
    workspaceSlug: { type: "string", required: true },
    q: { type: "string", required: false }
  });
  const definitions = [
    action({
      id: "demo.clock.read",
      input: workspaceInput,
      extensions: {
        assistant: {
          alwaysAvailable: true
        }
      },
      execute: async (input, context) => {
        clockExecution = { input, context };
        return { ok: true };
      }
    }),
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
    "assistant_action_execute",
    "demo_clock_read"
  ]);
  const clockTool = toolSet.tools.find((entry) => entry.actionId === "demo.clock.read");
  assert.equal(clockTool.alwaysAvailable, true);
  assert.equal(clockTool.parameters.required?.includes("workspaceSlug") || false, false);
  assert.deepEqual(await catalog.executeToolCall({
    toolName: clockTool.name,
    argumentsText: "{}",
    context,
    toolSet
  }), {
    ok: true,
    result: { ok: true }
  });
  assert.deepEqual(clockExecution.input, { workspaceSlug: "library" });
  assert.equal(clockExecution.context.channel, "automation");

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

test("operation search and unfiltered browsing discover collections despite different user terminology", async () => {
  const catalog = createServiceToolCatalog(createActions([
    action({ id: "library.books.list", extensions: { assistant: { description: "List books." } } }),
    action({ id: "warehouse.assets.list", extensions: { assistant: { description: "List assets." } } }),
    action({ id: "warehouse.assets.view" }),
    action({ id: "private.assets.list", permission: { require: "all", permissions: ["private.read"] } })
  ]), { maxDirectTools: 1 });
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  const searchTool = catalog.toOpenAiToolSchema(toolSet.tools[0]);
  assert.match(searchTool.function.description, /Search before claiming a capability is unavailable/u);
  assert.match(searchTool.function.parameters.properties.query.description, /every word must match/u);
  assert.match(searchTool.function.parameters.properties.query.description, /Omit query to browse/u);

  const missedSearch = await catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ query: "vehicles" }),
    context,
    toolSet
  });
  assert.deepEqual(missedSearch, { ok: true, result: { items: [], nextCursor: null, total: 0 } });

  const collectionSearch = await catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ query: "list" }),
    context,
    toolSet
  });
  assert.equal(collectionSearch.ok, true);
  assert.deepEqual(collectionSearch.result.items.map((item) => item.actionId), [
    "library.books.list", "warehouse.assets.list"
  ]);

  const browsedActions = [];
  let cursor;
  do {
    const page = await catalog.executeToolCall({
      toolName: "assistant_action_search",
      argumentsText: JSON.stringify({ limit: 1, ...(cursor ? { cursor } : {}) }),
      context,
      toolSet
    });
    assert.equal(page.ok, true);
    assert.equal(page.result.total, 3);
    browsedActions.push(...page.result.items.map((item) => item.actionId));
    cursor = page.result.nextCursor;
  } while (cursor);
  assert.deepEqual(browsedActions, ["library.books.list", "warehouse.assets.list", "warehouse.assets.view"]);
});

test("discovery mode bounds authorized always-available tools", () => {
  const definitions = Array.from({ length: 10 }, (_, index) => action({
    id: `demo.clock-${String(index + 1).padStart(2, "0")}.read`,
    extensions: {
      assistant: {
        alwaysAvailable: true
      }
    }
  }));
  definitions.push(action({
    id: "demo.clock-denied.read",
    permission: { require: "all", permissions: ["clock.read"] },
    extensions: {
      assistant: {
        alwaysAvailable: true
      }
    }
  }));

  const toolSet = createServiceToolCatalog(createActions(definitions), {
    maxDirectTools: 0
  }).resolveToolSet({ actor: { id: "7" }, surface: "admin" });

  assert.deepEqual(toolSet.tools.slice(0, 3).map((entry) => entry.name), [
    "assistant_action_search",
    "assistant_action_contract",
    "assistant_action_execute"
  ]);
  assert.equal(toolSet.tools.length, 11);
  assert.deepEqual(
    toolSet.tools.slice(3).map((entry) => entry.actionId),
    definitions.slice(0, 8).map((entry) => entry.id)
  );
  assert.equal(toolSet.tools.some((entry) => entry.actionId === "demo.clock-denied.read"), false);
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

test("each tool set carries its catalog's size limits for the calls made with it", () => {
  const context = { actor: { id: "7" }, surface: "admin" };
  const actions = createActions([action()]);
  const large = createServiceToolCatalog(actions, { maxToolArgumentBytes: 64 * 1024 });
  assert.deepEqual(large.resolveToolSet(context).limits, { maxToolArgumentBytes: 64 * 1024, maxToolResultBytes: 48 * 1024 });
  assert.equal(large.resolveToolSet(context, { discoveryOnly: true }).limits, large.limits);
  assert.equal(createServiceToolCatalog(actions).resolveToolSet(context).limits.maxToolArgumentBytes, 32 * 1024);
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

test("malformed tool arguments fail without running the action", async () => {
  let executions = 0;
  const actions = createActions([action({
    kind: "command",
    input: schema({ title: { type: "string" } }),
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  const toolName = toolSet.tools[0].name;

  for (const argumentsText of ['{"title":"x"', "[]", '"x"', "null", "7"]) {
    assert.deepEqual(await catalog.executeToolCall({ toolName, context, toolSet, argumentsText }), {
      ok: false,
      error: { code: "assistant_tool_arguments_invalid", message: "Tool arguments must be a JSON object.", status: 400 }
    }, argumentsText);
  }
  assert.equal(executions, 0);

  assert.equal((await catalog.executeToolCall({ toolName, context, toolSet, argumentsText: "  " })).ok, true);
  assert.equal(executions, 1);
});

test("wildcard and empty surfaces match named surfaces without bypassing permissions", async () => {
  for (const [surfaces, allowed] of [
    [["*"], ["admin", "app", "console", "custom"]],
    [["admin"], ["admin"]],
    [["admin", "console"], ["admin", "console"]]
  ]) {
    const catalog = createServiceToolCatalog(createActions([action({
      surfaces, permission: { require: "all", permissions: ["books.read"] }
    })]));
    for (const surface of ["admin", "app", "console", "custom"]) {
      const context = { actor: { id: "7" }, surface, permissions: ["books.read"] };
      const toolSet = catalog.resolveToolSet(context);
      assert.equal(toolSet.tools.length, allowed.includes(surface) ? 1 : 0);
      assert.equal(catalog.resolveToolSet({ ...context, permissions: [] }).tools.length, 0);
      if (toolSet.tools.length) {
        const denied = await catalog.executeToolCall({ toolName: toolSet.tools[0].name, toolSet,
          context: { ...context, permissions: [] } });
        assert.equal(denied.ok, false);
      }
    }
  }
});

test("explicit assistant exclusion wins over otherwise valid contracts", async () => {
  let executed = false;
  const catalog = createServiceToolCatalog(createActions([action({
    extensions: { assistant: { exclude: "Use the authenticated password form." } },
    execute: async () => { executed = true; return { ok: true }; }
  })]));
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  assert.equal(toolSet.tools.length, 0);
  const result = await catalog.executeToolCall({ toolName: "demo.books.list", context, toolSet });
  assert.equal(result.ok, false);
  assert.equal(executed, false);
});


test("catalogue retains unrestricted matching for externally supplied empty surface metadata", () => {
  // The kernel disallows registering an empty list, but catalogue adapters historically accept it.
  const catalog = createServiceToolCatalog({
    listDefinitions: () => [action({ surfaces: [] })],
    execute: async () => ({ ok: true })
  });
  for (const surface of ["admin", "app", "console", "custom"]) {
    assert.equal(catalog.resolveToolSet({ actor: { id: "7" }, surface }).tools.length, 1);
    assert.equal(catalog.resolveToolSet({ surface }).tools.length, 0);
  }
});

test("synchronous failure observers preserve thrown identity and exclude unknown descriptors", async () => {
  const originalFailure = Object.assign(new Error("Private database failure"), { statusCode: 500, code: "DATABASE_FAILED" });
  const observerFailure = new Error("Observer stopped this tool call");
  let executions = 0;
  const actions = createActions([action({
    execute: async () => { executions++; throw originalFailure; }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);
  const failures = [];
  const onFailure = error => { failures.push(error); throw observerFailure; };
  assert.deepEqual(await catalog.executeToolCall({ toolName: "missing", context, toolSet, onFailure }), {
    ok: false,
    error: { code: "assistant_tool_unknown", message: "Unknown tool." }
  });
  assert.deepEqual(failures, [], "unknown exposed descriptors return before the failure observer");
  assert.equal(executions, 0);
  await assert.rejects(catalog.executeToolCall({ toolName: toolSet.tools[0].name, context, toolSet, onFailure }),
    error => error === observerFailure);
  assert.equal(failures.length, 1);
  assert.equal(failures[0], originalFailure, "the callback receives the exact caught application error");
  assert.equal(executions, 1);
  assert.deepEqual(await catalog.executeToolCall({ toolName: toolSet.tools[0].name, context, toolSet }), {
    ok: false,
    error: { code: "DATABASE_FAILED", message: "Tool call failed.", status: 500 }
  });
  assert.equal(executions, 2);
  assert.equal(failures.length, 1, "no-callback safe failure conversion keeps its original behavior");
});

test("unsaved actions say so, are offered directly only to a caller that keeps them, run unlogged and are never discoverable", async () => {
  const runs = [];
  const run = (actionId) => async (_input, context) => {
    runs.push({ actionId, logged: isExecutionLogged(context) });
    return { ok: true };
  };
  const definitions = [
    action({ id: "demo.surveys.open", execute: run("demo.surveys.open"),
      extensions: { assistant: { unsaved: true, description: "List the surveys open to this person." } } }),
    action({ id: "demo.books.list", execute: run("demo.books.list") })
  ];
  const context = { actor: { id: "7" }, surface: "admin" };
  const catalog = createServiceToolCatalog(createActions(definitions));
  const discoveryNames = ["assistant_action_search", "assistant_action_contract", "assistant_action_execute"];
  const call = (toolSet, toolName, payload = {}) => catalog.executeToolCall({ toolName, argumentsText: JSON.stringify(payload), context, toolSet });

  const offered = catalog.resolveToolSet(context, { offerUnsaved: true });
  const privateTool = offered.tools.find((entry) => entry.actionId === "demo.surveys.open");
  assert.equal(privateTool.unsaved, true, "The catalogue says the tool is unsaved, so an app test can assert it");
  assert.equal(offered.tools.find((entry) => entry.actionId === "demo.books.list").unsaved, false);
  assert.equal(privateTool.description,
    "List the surveys open to this person. Private: its call and result are kept only for this reply, so call it again when a later message needs them.");
  assert.deepEqual(offered.withheld, []);
  assert.deepEqual(await call(offered, privateTool.name), { ok: true, result: { ok: true } });
  assert.deepEqual(await call(offered, "demo_books_list"), { ok: true, result: { ok: true } });
  assert.deepEqual(runs.splice(0), [{ actionId: "demo.surveys.open", logged: false }, { actionId: "demo.books.list", logged: true }],
    "Only the unsaved action's execution is marked unlogged");

  const notKept = catalog.resolveToolSet(context);
  assert.deepEqual(notKept.tools.map((entry) => entry.actionId), ["demo.books.list"]);
  assert.deepEqual(notKept.withheld, [{ name: privateTool.name, actionId: "demo.surveys.open",
    reason: "This assistant does not keep unsaved tool calls out of what it saves, so it is not offered here." }]);
  assert.equal(catalog.resolveToolSet(context, { unsavedRefusal: "This host saves its own history." }).withheld[0].reason,
    "This host saves its own history.", "A caller names its own reason");
  assert.equal((await call(notKept, privateTool.name)).error.code, "assistant_tool_unknown");
  assert.equal((await catalog.executeToolCall({ toolName: privateTool.name, argumentsText: "{}", context })).error.code,
    "assistant_tool_unknown", "A call without a tool set never reaches it");

  const discovery = catalog.resolveToolSet(context, { discoveryOnly: true, offerUnsaved: true });
  assert.deepEqual(discovery.tools.map((entry) => entry.name), discoveryNames);
  assert.equal(discovery.withheld[0].reason, "Only the discovery tools are offered here, and an unsaved action is never discoverable.");
  const found = await call(discovery, "assistant_action_search", { query: "surveys" });
  assert.equal(found.result.total, 0);
  assert.equal(JSON.stringify((await call(discovery, "assistant_action_search", {})).result).includes("surveys"), false);
  assert.equal((await call(discovery, "assistant_action_contract", { actionId: "demo.surveys.open", version: 1 })).error.code, "assistant_action_unknown");
  assert.equal((await call(discovery, "assistant_action_execute", { actionId: "demo.surveys.open", version: 1, input: {} })).ok, false);
  assert.deepEqual(runs, [], "Discovery never runs an unsaved action");

  const crowded = createServiceToolCatalog(createActions(definitions), { maxDirectTools: 1 });
  assert.deepEqual(crowded.resolveToolSet(context, { offerUnsaved: true }).tools.map((entry) => entry.name), [...discoveryNames, privateTool.name],
    "Beside discovery an unsaved action is offered directly");
  assert.deepEqual(crowded.resolveToolSet(context).tools.map((entry) => entry.name), ["demo_books_list"],
    "A withheld action does not tip a caller into discovery");
  const many = createServiceToolCatalog(createActions(Array.from({ length: 9 }, (_, index) => action({
    id: `demo.private-${index + 1}.read`, extensions: { assistant: { unsaved: true } } }))), { maxDirectTools: 0 });
  const bounded = many.resolveToolSet(context, { offerUnsaved: true });
  assert.equal(bounded.tools.length, discoveryNames.length + 8);
  assert.deepEqual(bounded.withheld.map((entry) => [entry.actionId, entry.reason]),
    [["demo.private-9.read", "At most 8 actions are offered directly beside action discovery."]]);

  const misdeclared = createServiceToolCatalog(createActions([action({ id: "demo.surveys.open", extensions: { assistant: { unsaved: "yes" } } })]));
  assert.throws(() => misdeclared.resolveToolSet(context), {
    name: "TypeError",
    message: 'Action "demo.surveys.open" sets extensions.assistant.unsaved to "yes": it must be true or false.'
  }, "A malformed declaration stops the catalogue instead of dropping the action");
  assert.throws(() => catalog.resolveToolSet(context, { offerUnsaved: "yes" }), /offerUnsaved must be a boolean/);
});
