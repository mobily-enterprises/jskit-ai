import test from "node:test";
import assert from "node:assert/strict";
import { createChatService } from "../src/server/services/chatService.js";

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
    serviceToolCatalog
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
});
