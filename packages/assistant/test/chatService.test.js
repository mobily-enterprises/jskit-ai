import test from "node:test";
import assert from "node:assert/strict";
import { createChatService } from "../src/server/services/chatService.js";

function createAssistantSettingsServiceStub({ prompt = "" } = {}) {
  return {
    async resolveSystemPrompt() {
      return String(prompt || "");
    }
  };
}

test("chat service system prompt includes current workspace slug from resolved workspace context", async () => {
  let capturedMessages = null;

  const aiClient = {
    enabled: true,
    provider: "openai",
    defaultModel: "gpt-test",
    async createChatCompletionStream(payload = {}) {
      capturedMessages = Array.isArray(payload.messages) ? payload.messages : null;

      return (async function* generate() {
        yield {
          choices: [
            {
              delta: {
                content: "Hello"
              }
            }
          ]
        };
      })();
    }
  };

  const transcriptService = {
    async createConversationForTurn() {
      return {
        conversation: {
          id: 42
        }
      };
    },
    async appendMessage() {
      return null;
    },
    async completeConversation() {
      return null;
    }
  };

  const serviceToolCatalog = {
    resolveToolSet() {
      return {
        tools: [],
        byName: new Map()
      };
    },
    toOpenAiToolSchema() {
      return {
        type: "function",
        function: {
          name: "noop",
          description: "noop",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      };
    }
  };

  const streamWriter = {
    sendMeta() {},
    sendAssistantDelta() {},
    sendAssistantMessage() {},
    sendToolCall() {},
    sendToolResult() {},
    sendError() {},
    sendDone() {}
  };

  const chatService = createChatService({
    aiClient,
    transcriptService,
    serviceToolCatalog,
    assistantSettingsService: createAssistantSettingsServiceStub({
      prompt: "Always answer in short bullet points."
    })
  });

  await chatService.streamChat(
    {
      messageId: "msg_1",
      input: "Hi assistant"
    },
    {
      context: {
        actor: {
          id: 7
        },
        workspace: {
          id: 1,
          slug: "tonymobily3"
        },
        requestMeta: {
          resolvedWorkspaceContext: {
            workspace: {
              slug: "tonymobily3"
            }
          }
        }
      },
      streamWriter
    }
  );

  assert.ok(Array.isArray(capturedMessages));
  assert.equal(capturedMessages[0]?.role, "system");
  assert.match(String(capturedMessages[0]?.content || ""), /Current workspace slug: tonymobily3\./);
  assert.match(String(capturedMessages[0]?.content || ""), /Always answer in short bullet points\./);
});

test("chat service recovers with a final assistant answer when a tool call fails", async () => {
  const completionPayloads = [];
  const appendedMessages = [];
  const completedStatuses = [];
  const emittedAssistantMessages = [];
  const emittedDone = [];
  let streamCall = 0;

  const aiClient = {
    enabled: true,
    provider: "openai",
    defaultModel: "gpt-test",
    async createChatCompletionStream(payload = {}) {
      completionPayloads.push(payload);
      streamCall += 1;

      if (streamCall === 1) {
        return (async function* generateToolCall() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tool_1",
                      function: {
                        name: "users_accountprofile_service_getforuser",
                        arguments: "{}"
                      }
                    }
                  ]
                }
              }
            ]
          };
        })();
      }

      return (async function* generateRecoveryAnswer() {
        yield {
          choices: [
            {
              delta: {
                content: "Recovered answer."
              }
            }
          ]
        };
      })();
    }
  };

  const transcriptService = {
    async createConversationForTurn() {
      return {
        conversation: {
          id: 77
        }
      };
    },
    async appendMessage(_conversationId, payload = {}) {
      appendedMessages.push(payload);
      return null;
    },
    async completeConversation(_conversationId, payload = {}) {
      completedStatuses.push(String(payload.status || ""));
      return null;
    }
  };

  const serviceToolCatalog = {
    resolveToolSet() {
      const descriptor = {
        name: "users_accountprofile_service_getforuser",
        actionId: "settings.read",
        actionVersion: 1,
        description: "Read account profile.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true
        }
      };

      return {
        tools: [descriptor],
        byName: new Map([[descriptor.name, descriptor]])
      };
    },
    toOpenAiToolSchema(tool = {}) {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      };
    },
    async executeToolCall() {
      return {
        ok: false,
        error: {
          code: "ACTION_SURFACE_FORBIDDEN",
          message: "Forbidden.",
          status: 403
        }
      };
    }
  };

  const streamWriter = {
    sendMeta() {},
    sendAssistantDelta() {},
    sendAssistantMessage(payload = {}) {
      emittedAssistantMessages.push(String(payload.text || ""));
    },
    sendToolCall() {},
    sendToolResult() {},
    sendError() {},
    sendDone(payload = {}) {
      emittedDone.push(String(payload.status || ""));
    }
  };

  const chatService = createChatService({
    aiClient,
    transcriptService,
    serviceToolCatalog,
    assistantSettingsService: createAssistantSettingsServiceStub()
  });

  const result = await chatService.streamChat(
    {
      messageId: "msg_recovery",
      input: "Know everything."
    },
    {
      context: {
        actor: {
          id: 7
        },
        workspace: {
          id: 1,
          slug: "tonymobily3"
        },
        surface: "admin"
      },
      streamWriter
    }
  );

  assert.equal(result.status, "completed");
  assert.equal(streamCall, 2);
  assert.equal(Array.isArray(completionPayloads[1]?.tools), true);
  assert.equal(completionPayloads[1].tools.length, 0);
  assert.ok(
    appendedMessages.some((entry) => entry.role === "assistant" && entry.kind === "chat" && entry.contentText === "Recovered answer.")
  );
  assert.deepEqual(completedStatuses, ["completed"]);
  assert.deepEqual(emittedAssistantMessages, ["Recovered answer."]);
  assert.deepEqual(emittedDone, ["completed"]);
});

test("chat service strips raw tool-call markup from recovery assistant output", async () => {
  const emittedAssistantMessages = [];
  let streamCall = 0;

  const aiClient = {
    enabled: true,
    provider: "openai",
    defaultModel: "gpt-test",
    async createChatCompletionStream() {
      streamCall += 1;

      if (streamCall === 1) {
        return (async function* generateToolCall() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tool_1",
                      function: {
                        name: "users_workspace_service_listworkspacesforauthenticatedus",
                        arguments: "{}"
                      }
                    }
                  ]
                }
              }
            ]
          };
        })();
      }

      return (async function* generateRecoveryAnswer() {
        yield {
          choices: [
            {
              delta: {
                content:
                  "<｜DSML｜function_calls>\n<｜DSML｜invoke name=\"users_console_settings_service_getsettings\"></｜DSML｜invoke>\n</｜DSML｜function_calls>"
              }
            }
          ]
        };
      })();
    }
  };

  const transcriptService = {
    async createConversationForTurn() {
      return {
        conversation: {
          id: 99
        }
      };
    },
    async appendMessage() {
      return null;
    },
    async completeConversation() {
      return null;
    }
  };

  const serviceToolCatalog = {
    resolveToolSet() {
      const descriptor = {
        name: "users_workspace_service_listworkspacesforauthenticatedus",
        actionId: "workspace.list",
        actionVersion: 1,
        description: "List workspaces for actor.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true
        }
      };

      return {
        tools: [descriptor],
        byName: new Map([[descriptor.name, descriptor]])
      };
    },
    toOpenAiToolSchema(tool = {}) {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      };
    },
    async executeToolCall() {
      return {
        ok: false,
        error: {
          code: "assistant_tool_failed",
          message: "Tool failed.",
          status: 500
        }
      };
    }
  };

  const streamWriter = {
    sendMeta() {},
    sendAssistantDelta() {},
    sendAssistantMessage(payload = {}) {
      emittedAssistantMessages.push(String(payload.text || ""));
    },
    sendToolCall() {},
    sendToolResult() {},
    sendError() {},
    sendDone() {}
  };

  const chatService = createChatService({
    aiClient,
    transcriptService,
    serviceToolCatalog,
    assistantSettingsService: createAssistantSettingsServiceStub()
  });

  await chatService.streamChat(
    {
      messageId: "msg_markup",
      input: "Tell me about this workspace."
    },
    {
      context: {
        actor: {
          id: 7
        },
        workspace: {
          id: 1,
          slug: "tonymobily3"
        },
        surface: "admin"
      },
      streamWriter
    }
  );

  assert.equal(emittedAssistantMessages.length, 1);
  assert.equal(
    emittedAssistantMessages[0],
    "I could not gather additional information from successful operations."
  );
});

test("chat service retries plain-language recovery before fallback when post-failure completion text is empty", async () => {
  const completionPayloads = [];
  const emittedAssistantMessages = [];
  let streamCall = 0;

  const aiClient = {
    enabled: true,
    provider: "openai",
    defaultModel: "gpt-test",
    async createChatCompletionStream(payload = {}) {
      completionPayloads.push(payload);
      streamCall += 1;

      if (streamCall === 1) {
        return (async function* generateToolCall() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tool_1",
                      function: {
                        name: "users_workspace_service_listworkspacesforauthenticatedus",
                        arguments: "{}"
                      }
                    }
                  ]
                }
              }
            ]
          };
        })();
      }

      if (streamCall === 2) {
        return (async function* generateEmptyAssistantText() {
          yield {
            choices: [
              {
                delta: {
                  content: ""
                }
              }
            ]
          };
        })();
      }

      return (async function* generateRecoveryAnswer() {
        yield {
          choices: [
            {
              delta: {
                content: "I could not run one workspace operation, but I can continue with the others."
              }
            }
          ]
        };
      })();
    }
  };

  const transcriptService = {
    async createConversationForTurn() {
      return {
        conversation: {
          id: 122
        }
      };
    },
    async appendMessage() {
      return null;
    },
    async completeConversation() {
      return null;
    }
  };

  const serviceToolCatalog = {
    resolveToolSet() {
      const descriptor = {
        name: "users_workspace_service_listworkspacesforauthenticatedus",
        actionId: "workspace.list",
        actionVersion: 1,
        description: "List workspaces for actor.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true
        }
      };

      return {
        tools: [descriptor],
        byName: new Map([[descriptor.name, descriptor]])
      };
    },
    toOpenAiToolSchema(tool = {}) {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      };
    },
    async executeToolCall() {
      return {
        ok: false,
        error: {
          code: "assistant_tool_failed",
          message: "Tool failed.",
          status: 500
        }
      };
    }
  };

  const streamWriter = {
    sendMeta() {},
    sendAssistantDelta() {},
    sendAssistantMessage(payload = {}) {
      emittedAssistantMessages.push(String(payload.text || ""));
    },
    sendToolCall() {},
    sendToolResult() {},
    sendError() {},
    sendDone() {}
  };

  const chatService = createChatService({
    aiClient,
    transcriptService,
    serviceToolCatalog,
    assistantSettingsService: createAssistantSettingsServiceStub()
  });

  await chatService.streamChat(
    {
      messageId: "msg_empty_after_failure",
      input: "Tell me everything."
    },
    {
      context: {
        actor: {
          id: 7
        },
        workspace: {
          id: 1,
          slug: "tonymobily3"
        },
        surface: "admin"
      },
      streamWriter
    }
  );

  assert.equal(streamCall, 3);
  assert.equal(Array.isArray(completionPayloads[2]?.tools), true);
  assert.equal(completionPayloads[2].tools.length, 0);
  assert.equal(
    emittedAssistantMessages[0],
    "I could not run one workspace operation, but I can continue with the others."
  );
});

test("chat service recovery streams sanitized text without DSML tag leakage", async () => {
  const emittedAssistantMessages = [];
  const streamedDeltas = [];
  let streamCall = 0;

  const aiClient = {
    enabled: true,
    provider: "openai",
    defaultModel: "gpt-test",
    async createChatCompletionStream() {
      streamCall += 1;

      if (streamCall === 1) {
        return (async function* generateInitialToolCall() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tool_1",
                      function: {
                        name: "users_workspace_service_listworkspacesforauthenticatedus",
                        arguments: "{}"
                      }
                    }
                  ]
                }
              }
            ]
          };
        })();
      }

      if (streamCall === 2) {
        return (async function* generateRecoveryDsmlAndText() {
          yield {
            choices: [
              {
                delta: {
                  content:
                    "<｜DSML｜function_calls>\n<｜DSML｜invoke name=\"users_console_settings_service_getsettings\"></｜DSML｜invoke>\n</｜DSML｜function_calls>Interim notes from successful operations."
                }
              }
            ]
          };
        })();
      }

      return (async function* generateFinalRecoveryAnswer() {
        yield {
          choices: [
            {
              delta: {
                content: "Final response from available data."
              }
            }
          ]
        };
      })();
    }
  };

  const transcriptService = {
    async createConversationForTurn() {
      return {
        conversation: {
          id: 200
        }
      };
    },
    async appendMessage() {
      return null;
    },
    async completeConversation() {
      return null;
    }
  };

  const serviceToolCatalog = {
    resolveToolSet() {
      const first = {
        name: "users_workspace_service_listworkspacesforauthenticatedus",
        actionId: "workspace.list",
        actionVersion: 1,
        description: "List workspaces for actor.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true
        }
      };
      const second = {
        name: "users_console_settings_service_getsettings",
        actionId: "console.settings.get",
        actionVersion: 1,
        description: "Read console settings.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true
        }
      };

      return {
        tools: [first, second],
        byName: new Map([
          [first.name, first],
          [second.name, second]
        ])
      };
    },
    toOpenAiToolSchema(tool = {}) {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      };
    },
    async executeToolCall({ toolName = "" } = {}) {
      if (toolName === "users_workspace_service_listworkspacesforauthenticatedus") {
        return {
          ok: false,
          error: {
            code: "assistant_tool_failed",
            message: "Workspace listing failed.",
            status: 500
          }
        };
      }

      if (toolName === "users_console_settings_service_getsettings") {
        return {
          ok: true,
          result: {
            locale: "en"
          }
        };
      }

      return {
        ok: false,
        error: {
          code: "assistant_tool_unknown",
          message: "Unknown tool.",
          status: 400
        }
      };
    }
  };

  const streamWriter = {
    sendMeta() {},
    sendAssistantDelta(payload = {}) {
      streamedDeltas.push(String(payload.delta || ""));
    },
    sendAssistantMessage(payload = {}) {
      emittedAssistantMessages.push(String(payload.text || ""));
    },
    sendToolCall() {},
    sendToolResult() {},
    sendError() {},
    sendDone() {}
  };

  const chatService = createChatService({
    aiClient,
    transcriptService,
    serviceToolCatalog,
    assistantSettingsService: createAssistantSettingsServiceStub()
  });

  await chatService.streamChat(
    {
      messageId: "msg_stream_sanitized",
      input: "Tell me everything."
    },
    {
      context: {
        actor: {
          id: 7
        },
        workspace: {
          id: 1,
          slug: "tonymobily3"
        },
        surface: "admin"
      },
      streamWriter
    }
  );

  const streamedText = streamedDeltas.join("");
  assert.equal(streamedText.includes("DSML"), false, streamedText);
  assert.equal(streamedText.includes("Interim notes from successful operations."), true);
  assert.equal(emittedAssistantMessages.length, 1);
  assert.equal(emittedAssistantMessages[0].includes("Interim notes from successful operations."), true);
  assert.equal(emittedAssistantMessages[0].includes("Final response from available data."), true);
  assert.equal(emittedAssistantMessages[0].includes("DSML"), false);
});
