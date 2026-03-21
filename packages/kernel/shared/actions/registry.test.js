import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { createActionRegistry } from "./registry.js";

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
            inputValidator: { schema: createPassThroughSchema() },
            idempotency: "none",
            audit: {
              actionName: "settings.read"
            },
            observability: {},
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
            inputValidator: { schema: createPassThroughSchema() },
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

test("action registry merges action input validators", async () => {
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
            inputValidator: [
              {
                schema: Type.Object(
                  {
                    workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
                  },
                  { additionalProperties: false }
                ),
                normalize(input = {}) {
                  if (!Object.hasOwn(input, "workspaceSlug")) {
                    return {};
                  }

                  return {
                    workspaceSlug: String(input.workspaceSlug || "").trim().toLowerCase()
                  };
                }
              },
              {
                schema: Type.Object(
                  {
                    invitesEnabled: Type.Optional(Type.Boolean())
                  },
                  { additionalProperties: false }
                ),
                normalize(input = {}) {
                  if (!Object.hasOwn(input, "invitesEnabled")) {
                    return {};
                  }

                  return {
                    invitesEnabled: input.invitesEnabled === true
                  };
                }
              }
            ],
            idempotency: "optional",
            audit: {
              actionName: "workspace.settings.update"
            },
            observability: {},
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
                inputValidator: { schema: createPassThroughSchema() },
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
                inputValidator: { schema: createPassThroughSchema() },
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
            inputValidator: { schema: createPassThroughSchema() },
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

test("action registry ignores unknown legacy fields", async () => {
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
            inputValidator: { schema: createPassThroughSchema() },
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
            inputValidator: { schema: createPassThroughSchema() },
            idempotency: "optional",
            audit: {
              actionName: "workspace.settings.update"
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
