import assert from "node:assert/strict";
import test from "node:test";

import { createService as createAiService } from "../server/modules/ai/service.js";

function createStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  };
}

function createWriter(events) {
  return {
    sendMeta(payload) {
      events.push({ type: "meta", ...payload });
    },
    sendAssistantDelta(delta) {
      events.push({ type: "assistant_delta", delta });
    },
    sendAssistantMessage(text) {
      events.push({ type: "assistant_message", text });
    },
    sendToolCall(payload) {
      events.push({ type: "tool_call", ...payload });
    },
    sendToolResult(payload) {
      events.push({ type: "tool_result", ...payload });
    },
    sendError(payload) {
      events.push({ type: "error", ...payload });
    },
    sendDone(payload) {
      events.push({ type: "done", ...payload });
    }
  };
}

function createBaseRequest(overrides = {}) {
  return {
    id: "req-ai",
    method: "POST",
    url: "/api/workspace/ai/chat/stream",
    headers: {
      "x-command-id": "cmd-ai",
      "x-client-id": "client-ai"
    },
    workspace: {
      id: 22,
      slug: "acme",
      name: "Acme"
    },
    user: {
      id: 7,
      email: "owner@example.com"
    },
    permissions: ["workspace.settings.update"],
    log: {
      warn() {}
    },
    ...overrides
  };
}

test("ai service streams a plain assistant response without tools", async () => {
  const events = [];
  const audits = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        return createStream([
          {
            choices: [
              {
                delta: {
                  content: "Hello from assistant"
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {
        throw new Error("not used");
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe(event) {
        audits.push(event);
      }
    }
  });

  await service.streamChatTurn({
    request: createBaseRequest(),
    body: {
      messageId: "msg_1",
      input: "hello"
    },
    streamWriter: createWriter(events),
    abortSignal: new AbortController().signal
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["meta", "assistant_delta", "assistant_message", "done"]
  );
  assert.equal(events.find((event) => event.type === "assistant_message")?.text, "Hello from assistant");
  assert.deepEqual(
    audits.map((event) => [event.action, event.outcome]),
    [
      ["ai.chat.requested", "success"],
      ["ai.chat.completed", "success"]
    ]
  );
});

test("ai service records observability metrics for turns and tool calls", async () => {
  const events = [];
  const aiTurnMetrics = [];
  const aiToolMetrics = [];
  let providerCallCount = 0;

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        providerCallCount += 1;
        if (providerCallCount === 1) {
          return createStream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        function: {
                          name: "workspace_rename",
                          arguments: '{"name":"Renamed"}'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]);
        }

        return createStream([
          {
            choices: [
              {
                delta: {
                  content: "Done."
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings(workspace, payload) {
        return {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: payload.name
          }
        };
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    },
    observabilityService: {
      recordAiTurn(payload) {
        aiTurnMetrics.push(payload);
      },
      recordAiToolCall(payload) {
        aiToolMetrics.push(payload);
      }
    }
  });

  await service.streamChatTurn({
    request: createBaseRequest(),
    body: {
      messageId: "msg_metrics_1",
      input: "rename workspace"
    },
    streamWriter: createWriter(events),
    abortSignal: new AbortController().signal
  });

  assert.equal(aiTurnMetrics.length, 1);
  assert.equal(aiTurnMetrics[0].outcome, "success");
  assert.equal(aiTurnMetrics[0].surface, "app");
  assert.equal(aiTurnMetrics[0].provider, "openai");
  assert.equal(typeof aiTurnMetrics[0].durationMs, "number");
  assert.equal(aiTurnMetrics[0].durationMs >= 0, true);

  assert.deepEqual(aiToolMetrics, [
    {
      tool: "workspace_rename",
      outcome: "success"
    }
  ]);
});

test("ai service executes workspace rename tool and continues to final response", async () => {
  const events = [];
  const audits = [];
  const providerCalls = [];
  const updateCalls = [];
  const realtimeEvents = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream(payload) {
        providerCalls.push(payload);
        if (providerCalls.length === 1) {
          return createStream([
            {
              choices: [
                {
                  delta: {
                    content: "Renaming now.",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        function: {
                          name: "workspace_rename",
                          arguments: '{"name":"New'
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' Workspace"}'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]);
        }

        return createStream([
          {
            choices: [
              {
                delta: {
                  content: "Workspace renamed."
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings(workspace, payload) {
        updateCalls.push({ workspace, payload });
        return {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: payload.name
          }
        };
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent(payload) {
        realtimeEvents.push(payload);
      }
    },
    auditService: {
      async recordSafe(event) {
        audits.push(event);
      }
    }
  });

  await service.streamChatTurn({
    request: createBaseRequest(),
    body: {
      messageId: "msg_2",
      input: "rename workspace"
    },
    streamWriter: createWriter(events),
    abortSignal: new AbortController().signal
  });

  assert.equal(providerCalls.length, 2);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].payload, {
    name: "New Workspace"
  });
  assert.equal(realtimeEvents.length, 2);

  const eventTypes = events.map((event) => event.type);
  assert.equal(eventTypes.includes("tool_call"), true);
  assert.equal(eventTypes.includes("tool_result"), true);
  assert.equal(eventTypes[eventTypes.length - 1], "done");

  const toolResultEvent = events.find((event) => event.type === "tool_result");
  assert.equal(toolResultEvent.ok, true);

  assert.equal(
    audits.some((event) => event.action === "ai.tool.executed" && event.outcome === "success"),
    true
  );
});

test("ai service enforces max input length and emits validation error event", async () => {
  const events = [];
  const aiTurnMetrics = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        throw new Error("provider should not be called");
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {
        throw new Error("not used");
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    },
    observabilityService: {
      recordAiTurn(payload) {
        aiTurnMetrics.push(payload);
      }
    },
    aiMaxInputChars: 5
  });

  await assert.rejects(
    () =>
      service.streamChatTurn({
        request: createBaseRequest(),
        body: {
          messageId: "msg_3",
          input: "This is too long"
        },
        streamWriter: createWriter(events),
        abortSignal: new AbortController().signal
      }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );

  const errorEvent = events.find((event) => event.type === "error");
  assert.equal(errorEvent.code, "validation_failed");
  assert.deepEqual(aiTurnMetrics.map((event) => event.outcome), ["validation"]);
});

test("ai service enforces max tool calls across a single response", async () => {
  const events = [];
  const updateCalls = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        return createStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "workspace_rename",
                        arguments: '{"name":"One"}'
                      }
                    },
                    {
                      index: 1,
                      id: "call_2",
                      function: {
                        name: "workspace_rename",
                        arguments: '{"name":"Two"}'
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings(workspace, payload) {
        updateCalls.push({
          workspace,
          payload
        });
        return {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: payload.name
          }
        };
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    },
    aiMaxToolCallsPerTurn: 1
  });

  await assert.rejects(
    () =>
      service.streamChatTurn({
        request: createBaseRequest(),
        body: {
          messageId: "msg_limit_1",
          input: "rename twice"
        },
        streamWriter: createWriter(events),
        abortSignal: new AbortController().signal
      }),
    (error) => {
      assert.equal(error.status, 409);
      return true;
    }
  );

  assert.equal(updateCalls.length, 1);
  const errorEvent = events.find((event) => event.type === "error");
  assert.equal(errorEvent.code, "tool_limit_reached");
});

test("ai service exposes chat preflight validation helper", () => {
  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {}
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {}
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    },
    aiMaxInputChars: 3
  });

  const valid = service.validateChatTurnInput({
    body: {
      messageId: "msg_preflight_1",
      input: "hey",
      history: [
        {
          role: "user",
          content: "hi"
        }
      ]
    }
  });
  assert.equal(valid.messageId, "msg_preflight_1");
  assert.equal(valid.input, "hey");
  assert.equal(valid.history.length, 1);

  assert.throws(
    () =>
      service.validateChatTurnInput({
        body: {
          messageId: "msg_preflight_2",
          input: "too-long"
        }
      }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );
});

test("ai service handles tool permission denied and records tool_failed audit", async () => {
  const events = [];
  const audits = [];
  let updateCount = 0;
  let providerCallCount = 0;

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        providerCallCount += 1;
        if (providerCallCount === 1) {
          return createStream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_forbidden",
                        function: {
                          name: "workspace_rename",
                          arguments: '{"name":"Blocked"}'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]);
        }

        return createStream([
          {
            choices: [
              {
                delta: {
                  content: "I cannot do that."
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {
        updateCount += 1;
        return {
          workspace: {
            id: 22,
            slug: "acme",
            name: "Blocked"
          }
        };
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe(event) {
        audits.push(event);
      }
    }
  });

  await service.streamChatTurn({
    request: createBaseRequest({
      permissions: []
    }),
    body: {
      messageId: "msg_4",
      input: "rename workspace to blocked"
    },
    streamWriter: createWriter(events),
    abortSignal: new AbortController().signal
  });

  assert.equal(updateCount, 0);
  assert.equal(providerCallCount, 2);

  const toolResultEvent = events.find((event) => event.type === "tool_result");
  assert.equal(toolResultEvent.ok, false);
  assert.equal(toolResultEvent.error.code, "tool_forbidden");

  assert.equal(
    audits.some((event) => event.action === "ai.tool.failed" && event.outcome === "failure"),
    true
  );
});

test("ai service retries once when provider returns empty completion and then succeeds", async () => {
  const events = [];
  const providerCalls = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream(payload) {
        providerCalls.push(payload);
        if (providerCalls.length === 1) {
          return createStream([
            {
              choices: [
                {
                  delta: {}
                }
              ]
            }
          ]);
        }

        return createStream([
          {
            choices: [
              {
                delta: {
                  content: "Hello after retry."
                }
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {}
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    }
  });

  await service.streamChatTurn({
    request: createBaseRequest(),
    body: {
      messageId: "msg_empty_retry_1",
      input: "hello"
    },
    streamWriter: createWriter(events),
    abortSignal: new AbortController().signal
  });

  assert.equal(providerCalls.length, 2);
  assert.deepEqual(providerCalls[0].tools.map((tool) => tool?.function?.name), ["workspace_rename"]);
  assert.deepEqual(providerCalls[1].tools, []);
  assert.equal(events.find((event) => event.type === "assistant_message")?.text, "Hello after retry.");
  assert.equal(events.at(-1)?.type, "done");
});

test("ai service emits provider_empty_output error when completion stays empty after retry", async () => {
  const events = [];

  const service = createAiService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletionStream() {
        return createStream([
          {
            choices: [
              {
                delta: {}
              }
            ]
          }
        ]);
      }
    },
    workspaceAdminService: {
      async updateWorkspaceSettings() {}
    },
    realtimeEventsService: {
      publishWorkspaceEvent() {}
    },
    auditService: {
      async recordSafe() {}
    }
  });

  await assert.rejects(
    () =>
      service.streamChatTurn({
        request: createBaseRequest(),
        body: {
          messageId: "msg_empty_retry_2",
          input: "hello"
        },
        streamWriter: createWriter(events),
        abortSignal: new AbortController().signal
      }),
    (error) => {
      assert.equal(error.status, 502);
      return true;
    }
  );

  const errorEvent = events.find((event) => event.type === "error");
  assert.equal(errorEvent.code, "provider_empty_output");
  assert.equal(errorEvent.message, "AI provider returned no output.");
});
