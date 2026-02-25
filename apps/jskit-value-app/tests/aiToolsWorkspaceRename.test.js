import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantActionToolsResolver } from "../server/modules/ai/lib/tools/actionTools.js";

function createRequest(overrides = {}) {
  return {
    id: "req_tools_1",
    headers: {
      "x-surface-id": "admin",
      "x-command-id": "cmd_tools_1"
    },
    surface: "admin",
    workspace: {
      id: 17,
      slug: "acme"
    },
    user: {
      id: 9,
      email: "owner@example.com"
    },
    permissions: ["workspace.settings.update"],
    ...overrides
  };
}

test("assistant action tools resolver builds catalog from assistant_tool action definitions", async () => {
  const resolver = createAssistantActionToolsResolver({
    resolveActionExecutor: () => ({
      listDefinitions() {
        return [
          {
            id: "workspace.settings.update",
            version: 1,
            kind: "command",
            channels: ["api", "assistant_tool"],
            surfaces: ["admin"],
            visibility: "public",
            assistantTool: {
              description: "Update workspace settings.",
              inputJsonSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string"
                  }
                }
              }
            }
          },
          {
            id: "workspace.invite.create",
            version: 1,
            kind: "command",
            channels: ["api"],
            surfaces: ["admin"],
            visibility: "public"
          },
          {
            id: "chat.thread.message.send",
            version: 1,
            kind: "command",
            channels: ["assistant_tool"],
            surfaces: ["app"],
            visibility: "public",
            assistantTool: {
              description: "Send a chat message to a thread.",
              inputJsonSchema: {
                type: "object",
                required: ["threadId", "text"],
                properties: {
                  threadId: { type: "string" },
                  text: { type: "string" }
                }
              }
            }
          }
        ];
      },
      async execute() {
        return {
          ok: true
        };
      }
    })
  });

  const adminCatalog = await resolver({
    surfaceId: "admin",
    request: createRequest()
  });

  assert.deepEqual(
    adminCatalog.providerTools.map((entry) => entry?.function?.name),
    ["workspace_settings_update"]
  );
  assert.equal(adminCatalog.providerTools[0]?.function?.description, "Update workspace settings.");
  assert.deepEqual(adminCatalog.providerTools[0]?.function?.parameters, {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string"
      }
    }
  });
  assert.equal(adminCatalog.allowedToolNames.includes("workspace_settings_update"), true);

  const appCatalog = await resolver({
    surfaceId: "app",
    request: createRequest({
      surface: "app",
      headers: {
        "x-surface-id": "app"
      }
    })
  });

  assert.deepEqual(
    appCatalog.providerTools.map((entry) => entry?.function?.name),
    ["chat_thread_message_send"]
  );
  assert.equal(appCatalog.allowedToolNames.includes("workspace_settings_update"), false);
  assert.equal(appCatalog.providerTools[0]?.function?.description, "Send a chat message to a thread.");
  assert.deepEqual(appCatalog.providerTools[0]?.function?.parameters, {
    type: "object",
    required: ["threadId", "text"],
    properties: {
      threadId: { type: "string" },
      text: { type: "string" }
    }
  });
});

test("assistant action tools resolver executes via action executor with assistant_tool context", async () => {
  const calls = [];
  const resolver = createAssistantActionToolsResolver({
    resolveActionExecutor: () => ({
      listDefinitions() {
        return [
          {
            id: "workspace.settings.update",
            version: 1,
            kind: "command",
            channels: ["assistant_tool"],
            surfaces: ["admin"],
            visibility: "public"
          }
        ];
      },
      async execute(payload) {
        calls.push(payload);
        return {
          workspaceId: 17,
          workspaceSlug: "acme",
          name: payload.input?.name || ""
        };
      }
    })
  });

  const request = createRequest();
  const catalog = await resolver({
    surfaceId: "admin",
    request
  });
  const tool = catalog.toolRegistry.workspace_settings_update;
  const response = await tool.execute({
    args: {
      name: "Renamed Workspace"
    },
    context: {
      request,
      workspace: request.workspace,
      user: request.user,
      permissions: request.permissions,
      assistantMeta: {
        conversationId: "conv_1",
        toolCallId: "tool_call_1"
      }
    }
  });

  assert.equal(response.name, "Renamed Workspace");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionId, "workspace.settings.update");
  assert.equal(calls[0].context.channel, "assistant_tool");
  assert.equal(calls[0].context.surface, "admin");
  assert.equal(String(calls[0].context.requestMeta.idempotencyKey).startsWith("assist:conv_1:tool_call_1:"), true);
});

test("assistant action tools resolver enforces assistant action exposure config", async () => {
  const resolver = createAssistantActionToolsResolver({
    actionsConfig: {
      enabled: true,
      exposedActionIds: ["chat.thread.message.send"],
      blockedActionIds: []
    },
    resolveActionExecutor: () => ({
      listDefinitions() {
        return [
          {
            id: "workspace.settings.update",
            version: 1,
            kind: "command",
            channels: ["assistant_tool"],
            surfaces: ["admin"],
            visibility: "public"
          },
          {
            id: "chat.thread.message.send",
            version: 1,
            kind: "command",
            channels: ["assistant_tool"],
            surfaces: ["admin"],
            visibility: "public"
          }
        ];
      },
      async execute() {
        return {
          ok: true
        };
      }
    })
  });

  const catalog = await resolver({
    surfaceId: "admin",
    request: createRequest()
  });

  assert.deepEqual(
    catalog.providerTools.map((entry) => entry?.function?.name),
    ["chat_thread_message_send"]
  );
});
