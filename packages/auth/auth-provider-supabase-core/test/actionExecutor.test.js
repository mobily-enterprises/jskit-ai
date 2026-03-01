import assert from "node:assert/strict";
import test from "node:test";
import { createServerContributions } from "../src/shared/server.js";

function resolveActionExecutorFactory() {
  const contributions = createServerContributions();
  const definition = contributions.services.find((entry) => entry.id === "actionExecutor");
  assert.ok(definition, "actionExecutor service definition is required");
  assert.equal(typeof definition.create, "function");
  return definition.create;
}

test("actionExecutor derives actor/request metadata from request context", async () => {
  const calls = [];
  const createActionExecutor = resolveActionExecutorFactory();
  const actionExecutor = createActionExecutor({
    services: {
      actionRegistry: {
        async execute(payload) {
          calls.push(payload);
          return { ok: true };
        },
        async executeStream(payload) {
          calls.push(payload);
          return { ok: true };
        },
        listDefinitions() {
          return [];
        },
        getDefinition() {
          return null;
        }
      }
    }
  });

  const request = {
    id: "req-77",
    headers: {
      "x-surface-id": "admin",
      "x-command-id": "cmd-7",
      "idempotency-key": "idem-7",
      "user-agent": "test-agent"
    },
    ip: "127.0.0.1",
    user: {
      id: 77,
      email: "USER@example.com",
      roleId: "OWNER",
      isOperator: true
    },
    workspace: {
      id: 4,
      slug: "workspace-slug",
      name: "Workspace Name"
    },
    membership: {
      roleId: "owner",
      status: "active"
    },
    permissions: ["workspace.read"]
  };

  await actionExecutor.execute({
    actionId: "auth.logout",
    input: { some: "value" },
    context: {
      request,
      channel: "api"
    }
  });

  assert.equal(calls.length, 1);
  const payload = calls[0];
  assert.equal(payload.actionId, "auth.logout");
  assert.equal(payload.context.channel, "api");
  assert.equal(payload.context.surface, "admin");
  assert.equal(payload.context.actor.id, 77);
  assert.equal(payload.context.actor.email, "user@example.com");
  assert.deepEqual(payload.context.permissions, ["workspace.read"]);
  assert.equal(payload.context.requestMeta.requestId, "req-77");
  assert.equal(payload.context.requestMeta.commandId, "cmd-7");
  assert.equal(payload.context.requestMeta.idempotencyKey, "idem-7");
  assert.equal(payload.context.requestMeta.userAgent, "test-agent");
  assert.equal(payload.context.requestMeta.request, request);
});

test("actionExecutor honors explicit context overrides", async () => {
  let captured = null;
  const createActionExecutor = resolveActionExecutorFactory();
  const actionExecutor = createActionExecutor({
    services: {
      actionRegistry: {
        async execute(payload) {
          captured = payload;
          return { ok: true };
        },
        async executeStream() {
          return { ok: true };
        },
        listDefinitions() {
          return [];
        },
        getDefinition() {
          return null;
        }
      }
    }
  });

  const request = {
    headers: {
      "x-surface-id": "app"
    },
    user: {
      id: 5,
      email: "ignored@example.com"
    },
    permissions: ["ignored.permission"]
  };

  await actionExecutor.execute({
    actionId: "auth.logout",
    context: {
      request,
      actor: {
        id: 101,
        email: "preferred@example.com"
      },
      permissions: ["*"],
      surface: "console",
      channel: "api"
    }
  });

  assert.ok(captured);
  assert.equal(captured.context.actor.id, 101);
  assert.equal(captured.context.actor.email, "preferred@example.com");
  assert.deepEqual(captured.context.permissions, ["*"]);
  assert.equal(captured.context.surface, "console");
});
