import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionRegistry } from "./registry.js";
import { toRegisteredContributor } from "./actionDefinitions.js";
import { noActionPolicy } from "./actionPolicy.js";
import { silentLogger } from "../runtime/logger.js";
import { createValidationError } from "../runtime/errors.js";

/**
 * A registry of contributors registered as the catalogue registers them, without a
 * policy, whose execute() passes the input, context and deps the catalogue always passes.
 */
function createRegistry({ contributors, ...dependencies }) {
  const registry = createActionRegistry({
    ...dependencies,
    policy: noActionPolicy,
    contributors: contributors.map((contributor) => toRegisteredContributor(contributor, noActionPolicy))
  });
  return Object.freeze({
    execute: ({ actionId, version = null, input = {}, context = {}, deps = {} }) =>
      registry.execute({ actionId, version, input, context, deps }),
    getDefinition: registry.getDefinition,
    listDefinitions: registry.listDefinitions
  });
}

function createPassThroughSchema() {
  return createSchema({});
}

test("action registry executes latest version by default", async () => {
  const calls = [];

  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.settings",
        domain: "settings",
        actions: [
          {
            id: "settings.read",
            version: 1,
            domain: "settings",
            kind: "query",
            channels: ["api"],
            surfaces: ["app", "admin", "console"],
            input: { schema: createPassThroughSchema() },
            async execute() {
              calls.push("version-one");
              return {
                version: 1
              };
            }
          },
          {
            id: "settings.read",
            version: 2,
            domain: "settings",
            kind: "query",
            channels: ["api"],
            surfaces: ["app", "admin", "console"],
            input: { schema: createPassThroughSchema() },
            async execute() {
              calls.push("v2");
              return {
                version: 2
              };
            }
          }
        ]
      }
    ]
  });

  const result = await registry.execute({
    actionId: "settings.read",
    input: {},
    context: {
      channel: "api",
      surface: "app",
      permissions: ["settings.read"]
    }
  });

  assert.deepEqual(result, {
    version: 2
  });
  assert.deepEqual(calls, ["v2"]);
});

test("action registry validates action input with a single schema contract", async () => {
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.workspace",
        domain: "workspace",
        actions: [
          {
            id: "workspace.settings.update",
            version: 1,
            domain: "workspace",
            kind: "command",
            channels: ["api"],
            surfaces: ["app"],
            input: {
              schema: createSchema({
                workspaceSlug: {
                  type: "string",
                  required: false,
                  minLength: 1,
                  lowercase: true
                },
                invitesEnabled: {
                  type: "boolean",
                  required: false
                }
              })
            },
            async execute(input) {
              return input;
            }
          }
        ]
      }
    ]
  });

  const result = await registry.execute({
    actionId: "workspace.settings.update",
    input: {
      workspaceSlug: "  ACME  ",
      invitesEnabled: true
    },
    context: {
      channel: "api",
      surface: "app",
      permissions: []
    }
  });

  assert.deepEqual(result, {
    workspaceSlug: "acme",
    invitesEnabled: true
  });
});

test("action registry validates an input without a mode in create mode, and a patch input as a partial update", async () => {
  const schema = createSchema({
    title: { type: "string", required: true },
    notify: { type: "boolean", defaultTo: false }
  });
  const action = (id, input) => ({
    id,
    version: 1,
    kind: "command",
    channels: ["api"],
    surfaces: ["app"],
    input,
    execute: (validated) => validated
  });
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.notes",
        domain: "notes",
        actions: [
          action("notes.create", { schema }),
          action("notes.update", { schema, mode: "patch" })
        ]
      }
    ]
  });
  const context = { channel: "api", surface: "app", permissions: [] };

  assert.equal(registry.getDefinition("notes.create").input.mode, "create");
  assert.equal(registry.getDefinition("notes.update").input.mode, "patch");
  await assert.rejects(
    registry.execute({ actionId: "notes.create", input: { notify: true }, context }),
    (error) => error.code === "ACTION_VALIDATION_FAILED" && Object.keys(error.details.fieldErrors).join() === "title"
  );
  assert.deepEqual(await registry.execute({ actionId: "notes.create", input: { title: "Hello" }, context }), {
    title: "Hello",
    notify: false
  });
  assert.deepEqual(await registry.execute({ actionId: "notes.update", input: { notify: true }, context }), { notify: true });
});

test("an action's checkInput refuses its validated input before it runs, exactly as its input schema refuses a field", async () => {
  const executed = [];
  const checked = [];
  const fieldsMessage = 'fields keys must be resource types; use "books" instead of "book".';
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [{
      contributorId: "tests.books",
      domain: "books",
      actions: [{
        id: "books.list",
        channels: ["api"],
        surfaces: ["app"],
        input: {
          schema: createSchema({
            title: { type: "string", required: false, minLength: 2, messages: { minLength: { code: "tests.titleShort", message: "Title is short." } } },
            fields: { type: "object", required: false, additionalProperties: true }
          }),
          mode: "patch"
        },
        checkInput(input) {
          checked.push(input);
          if (input.fields?.book) {
            throw createValidationError({ "fields.book": { code: "tests.fieldsKeys", params: { type: "books" }, message: fieldsMessage } });
          }
        },
        execute: (input) => {
          executed.push(input);
          return input;
        }
      }]
    }]
  });
  const context = { channel: "api", surface: "app", permissions: [] };
  const refusal = (input) => registry.execute({ actionId: "books.list", input, context }).then(
    () => assert.fail(`books.list took ${JSON.stringify(input)}`),
    (error) => error
  );

  // The schema judges first, and a refused input never reaches checkInput.
  const bySchema = await refusal({ title: "x", fields: { book: ["title"] } });
  assert.equal(checked.length, 0);
  const byCheck = await refusal({ title: "  Dune  ", fields: { book: ["title"] } });
  assert.deepEqual(checked, [{ title: "Dune", fields: { book: ["title"] } }]);
  assert.deepEqual(executed, []);
  assert.equal(byCheck.constructor, bySchema.constructor);
  for (const key of ["status", "code", "message", "params"]) {
    assert.deepEqual(byCheck[key], bySchema[key], key);
  }
  assert.deepEqual(byCheck.details, {
    fieldErrors: { "fields.book": fieldsMessage },
    fieldErrorCodes: { "fields.book": { code: "tests.fieldsKeys", params: { type: "books" } } }
  });
  assert.deepEqual(bySchema.details.fieldErrors, { title: "Title is short." });
  assert.equal(bySchema.details.fieldErrorCodes.title.code, "tests.titleShort");

  assert.deepEqual(await registry.execute({ actionId: "books.list", input: { fields: { books: ["title"] } }, context }), {
    fields: { books: ["title"] }
  });
  assert.equal(executed.length, 1);
});

test("an action's checkInput that fails without field errors fails the action with its own error", async () => {
  const fault = new TypeError("The check broke.");
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [{
      contributorId: "tests.books",
      domain: "books",
      actions: [{
        id: "books.list",
        channels: ["api"],
        surfaces: ["app"],
        input: { schema: createSchema({}), mode: "patch" },
        checkInput() {
          throw fault;
        },
        execute: () => assert.fail("the action ran")
      }]
    }]
  });
  await assert.rejects(registry.execute({ actionId: "books.list", context: { channel: "api", surface: "app", permissions: [] } }), (error) => error === fault);
});

test("action registry fails startup on duplicate action id + version", () => {
  assert.throws(
    () =>
      createRegistry({
        logger: silentLogger,
        contributors: [
          {
            contributorId: "tests.a",
            domain: "settings",
            actions: [
              {
                id: "settings.profile.update",
                version: 1,
                domain: "settings",
                kind: "command",
                channels: ["api"],
                surfaces: ["app"],
                input: { schema: createPassThroughSchema() },
                async execute() {
                  return {
                    ok: true
                  };
                }
              }
            ]
          },
          {
            contributorId: "tests.b",
            domain: "settings",
            actions: [
              {
                id: "settings.profile.update",
                version: 1,
                domain: "settings",
                kind: "command",
                channels: ["api"],
                surfaces: ["app"],
                input: { schema: createPassThroughSchema() },
                async execute() {
                  return {
                    ok: true
                  };
                }
              }
            ]
          }
        ]
      }),
    /duplicated/
  );
});

test("action registry rejects invalid version requests", async () => {
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.settings",
        domain: "settings",
        actions: [
          {
            id: "settings.read",
            version: 1,
            domain: "settings",
            kind: "query",
            channels: ["api"],
            surfaces: ["app"],
            input: { schema: createPassThroughSchema() },
            async execute() {
              return {
                ok: true
              };
            }
          }
        ]
      }
    ]
  });

  await assert.rejects(
    () => registry.execute({ actionId: "settings.read", version: "invalid" }),
    (error) => {
      assert.equal(error.code, "ACTION_VERSION_INVALID");
      assert.deepEqual(error.details?.fieldErrors, {
        version: "version must be an integer >= 1."
      });
      return true;
    }
  );

  await assert.rejects(
    () => registry.execute({ actionId: "settings.read", version: 0 }),
    (error) => {
      assert.equal(error.code, "ACTION_VERSION_INVALID");
      return true;
    }
  );
});

test("action registry ignores unknown extra fields", async () => {
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.internal",
        domain: "settings",
        actions: [
          {
            id: "settings.internal.ping",
            version: 1,
            domain: "settings",
            kind: "query",
            channels: ["api", "internal"],
            surfaces: ["app"],
            consoleUsersOnly: true,
            input: { schema: createPassThroughSchema() },
            async execute() {
              return { ok: true };
            }
          }
        ]
      }
    ]
  });

  const result = await registry.execute({
    actionId: "settings.internal.ping",
    context: {
      channel: "api",
      surface: "app"
    }
  });
  assert.deepEqual(result, { ok: true });
});

test("action registry enforces action-level permissions", async () => {
  const registry = createRegistry({
    logger: silentLogger,
    contributors: [
      {
        contributorId: "tests.permissions",
        domain: "workspace",
        actions: [
          {
            id: "workspace.settings.update",
            version: 1,
            domain: "workspace",
            kind: "command",
            channels: ["api", "internal"],
            surfaces: ["app"],
            permission: {
              require: "all",
              permissions: ["workspace.settings.update"]
            },
            input: { schema: createPassThroughSchema() },
            async execute() {
              return { ok: true };
            }
          }
        ]
      }
    ]
  });

  await assert.rejects(
    () =>
      registry.execute({
        actionId: "workspace.settings.update",
        context: {
          channel: "api",
          surface: "app",
          actor: { id: 7 },
          permissions: ["workspace.settings.view"]
        }
      }),
    (error) => {
      assert.equal(error.code, "ACTION_PERMISSION_DENIED");
      return true;
    }
  );

  const allowed = await registry.execute({
    actionId: "workspace.settings.update",
    context: {
      channel: "api",
      surface: "app",
      actor: { id: 7 },
      permissions: ["workspace.settings.update"]
    }
  });

  assert.deepEqual(allowed, { ok: true });
});

function createSingleActionRegistry(action, options = {}) {
  return createRegistry({
    logger: silentLogger,
    ...options,
    contributors: [
      {
        contributorId: "tests.single",
        domain: "tests",
        actions: [
          {
            id: "tests.run",
            version: 1,
            kind: "command",
            channels: ["api"],
            surfaces: ["app"],
            input: { schema: createPassThroughSchema() },
            ...action
          }
        ]
      }
    ]
  });
}

test("action registry logs one debug entry per outcome and returns the result directly", async () => {
  const entries = [];
  const logger = { debug: (payload, message) => entries.push({ payload, message }) };
  let fail = false;
  const registry = createSingleActionRegistry({
    async execute() {
      if (fail) {
        throw Object.assign(new Error("boom"), { code: "TEST_FAILED" });
      }
      return { ok: true };
    }
  }, { logger });
  const context = { channel: "api", surface: "app", requestMeta: { requestId: "req-1" } };

  assert.deepEqual(await registry.execute({ actionId: "tests.run", context }), { ok: true });
  fail = true;
  await assert.rejects(() => registry.execute({ actionId: "tests.run", context }), { code: "TEST_FAILED" });

  assert.deepEqual(
    entries.map(({ payload, message }) => ({ ...payload, durationMs: typeof payload.durationMs, message })),
    [
      { action: "tests.run", version: 1, channel: "api", surface: "app", requestId: "req-1", durationMs: "number", outcome: "success", errorCode: null, message: "action.execution" },
      { action: "tests.run", version: 1, channel: "api", surface: "app", requestId: "req-1", durationMs: "number", outcome: "failure", errorCode: "TEST_FAILED", message: "action.execution" }
    ]
  );
});
