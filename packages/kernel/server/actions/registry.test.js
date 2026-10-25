import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionRegistry } from "./registry.js";

function createPassThroughSchema() {
  return createSchema({});
}

test("action registry executes latest version by default", async () => {
  const calls = [];

  const registry = createActionRegistry({
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
            idempotency: "none",
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
            idempotency: "none",
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
  const registry = createActionRegistry({
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
            idempotency: "optional",
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

test("action registry fails startup on duplicate action id + version", () => {
  assert.throws(
    () =>
      createActionRegistry({
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
                idempotency: "optional",
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
                idempotency: "optional",
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
  const registry = createActionRegistry({
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
            idempotency: "none",
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
  const registry = createActionRegistry({
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
            idempotency: "none",
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
  const registry = createActionRegistry({
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
            idempotency: "optional",
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
  return createActionRegistry({
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

test("action registry requires an idempotency key only for required actions", async () => {
  const registry = createSingleActionRegistry({
    idempotency: "required",
    async execute() {
      return { ok: true };
    }
  }, { logger: null });
  const context = { channel: "api", surface: "app" };

  await assert.rejects(
    () => registry.execute({ actionId: "tests.run", context }),
    { code: "ACTION_IDEMPOTENCY_KEY_REQUIRED", status: 400 }
  );
  assert.deepEqual(
    await registry.execute({ actionId: "tests.run", context: { ...context, requestMeta: { commandId: " cmd-1 " } } }),
    { ok: true }
  );
});

test("action registry logs one debug entry per outcome and returns the result directly", async () => {
  const entries = [];
  const logger = { debug: (payload, message) => entries.push({ payload, message }) };
  let fail = false;
  const registry = createSingleActionRegistry({
    idempotency: "optional",
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
