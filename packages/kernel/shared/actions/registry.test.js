import assert from "node:assert/strict";
import test from "node:test";

import { createActionRegistry } from "./registry.js";
import { createPermissionEvaluator } from "./policies.js";

function createPassThroughSchema() {
  return {
    parse(value) {
      return value;
    }
  };
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
            visibility: "public",
            input: { schema: createPassThroughSchema() },
            permission: ["settings.read"],
            idempotency: "none",
            audit: {
              actionName: "settings.read"
            },
            observability: {},
            async execute() {
              calls.push("v1");
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
            visibility: "public",
            input: { schema: createPassThroughSchema() },
            permission: ["settings.read"],
            idempotency: "none",
            audit: {
              actionName: "settings.read"
            },
            observability: {},
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
                visibility: "public",
                input: { schema: createPassThroughSchema() },
                permission: ["settings.profile.update"],
                idempotency: "optional",
                audit: {
                  actionName: "settings.profile.update"
                },
                observability: {},
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
                visibility: "public",
                input: { schema: createPassThroughSchema() },
                permission: ["settings.profile.update"],
                idempotency: "optional",
                audit: {
                  actionName: "settings.profile.update"
                },
                observability: {},
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

test("permission evaluator supports array and callback policies", async () => {
  const evaluator = createPermissionEvaluator();

  const staticDenied = await evaluator.evaluate({
    definition: {
      permission: ["workspace.settings.update"]
    },
    context: {
      permissions: ["workspace.settings.read"]
    },
    input: {}
  });
  assert.equal(staticDenied.allowed, false);

  const dynamicAllowed = await evaluator.evaluate({
    definition: {
      permission: (_context, input) => Boolean(input?.allow)
    },
    context: {
      permissions: []
    },
    input: {
      allow: true
    }
  });
  assert.equal(dynamicAllowed.allowed, true);
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
            visibility: "public",
            input: { schema: createPassThroughSchema() },
            permission: ["settings.read"],
            idempotency: "none",
            audit: {
              actionName: "settings.read"
            },
            observability: {},
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

test("action registry enforces internal visibility for user actors", async () => {
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
            visibility: "internal",
            input: { schema: createPassThroughSchema() },
            permission: () => true,
            idempotency: "none",
            audit: {
              actionName: "settings.internal.ping"
            },
            observability: {},
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
        actionId: "settings.internal.ping",
        context: {
          channel: "api",
          surface: "app",
          actor: { id: "user-1" },
          permissions: []
        }
      }),
    (error) => {
      assert.equal(error.code, "ACTION_VISIBILITY_FORBIDDEN");
      return true;
    }
  );
});
