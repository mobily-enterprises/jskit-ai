import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutes } from "../src/shared/routes.js";

test("buildRoutes maps chat handlers and applies configured upload body limit", () => {
  const wrappedResponses = [];
  const routes = buildRoutes(
    {
      chat: {
        ensureWorkspaceRoom() {},
        ensureDm() {},
        listDmCandidates() {},
        listInbox() {},
        getThread() {},
        listThreadMessages() {},
        sendThreadMessage() {},
        reserveThreadAttachment() {},
        uploadThreadAttachment() {},
        deleteThreadAttachment() {},
        getAttachmentContent() {},
        markThreadRead() {},
        emitThreadTyping() {},
        addReaction() {},
        removeReaction() {}
      }
    },
    {
      withStandardErrorResponses(success, options) {
        wrappedResponses.push({ success, options });
        return success;
      },
      attachmentMaxUploadBytes: 1_024
    }
  );

  assert.equal(Array.isArray(routes), true);
  assert.ok(routes.length > 10);
  assert.ok(wrappedResponses.length > 10);

  const uploadRoute = routes.find((route) => route.path === "/api/chat/threads/:threadId/attachments/upload");
  assert.ok(uploadRoute);
  assert.equal(uploadRoute.bodyLimit, 1_024 + 256 * 1024);
});
