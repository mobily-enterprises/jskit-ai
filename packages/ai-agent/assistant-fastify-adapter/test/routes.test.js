import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutes } from "../src/shared/routes.js";

test("assistant buildRoutes emits stream/list/message routes and applies error-response wrapper", () => {
  const wrapped = [];
  const routes = buildRoutes(
    {
      ai: {
        chatStream() {},
        listConversations() {},
        getConversationMessages() {}
      }
    },
    {
      withStandardErrorResponses(success, options) {
        wrapped.push({ success, options });
        return success;
      },
      aiEnabled: true,
      aiRequiredPermission: "workspace.ai.chat.use"
    }
  );

  assert.equal(routes.length, 3);
  assert.equal(wrapped.length, 3);
  assert.equal(routes[0].path, "/api/workspace/ai/chat/stream");
  assert.equal(routes[1].path, "/api/workspace/ai/conversations");
  assert.equal(routes[2].path, "/api/workspace/ai/conversations/:conversationId/messages");
  assert.equal(routes[0].permission, "workspace.ai.chat.use");
});
