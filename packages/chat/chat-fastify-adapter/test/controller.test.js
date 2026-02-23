import test from "node:test";
import assert from "node:assert/strict";
import { __testables, createController } from "../src/controller.js";

test("createController forwards ensureDm call to chatService", async () => {
  const calls = [];
  const controller = createController({
    chatService: {
      async ensureDm(payload) {
        calls.push(payload);
        return { ok: true };
      },
      async ensureWorkspaceRoom() {},
      async listDmCandidates() {},
      async listInbox() {},
      async getThread() {},
      async listThreadMessages() {},
      async sendThreadMessage() {},
      async reserveThreadAttachment() {},
      async uploadThreadAttachment() {},
      async deleteThreadAttachment() {},
      async getAttachmentContent() {},
      async markThreadRead() {},
      async addReaction() {},
      async removeReaction() {},
      async emitThreadTyping() {}
    }
  });

  const reply = {
    statusCode: 0,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
    }
  };

  await controller.ensureDm(
    {
      user: { id: 10 },
      body: { targetPublicChatId: "user_22" }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { ok: true });
  assert.deepEqual(calls[0], {
    user: { id: 10 },
    targetPublicChatId: "user_22"
  });
});

test("readOneMultipartAttachment returns validation error when multipart payload is missing", async () => {
  const request = {
    async file() {
      return null;
    }
  };

  await assert.rejects(
    () => __testables.readOneMultipartAttachment(request, 1024, __testables.DefaultAppError),
    (error) => {
      assert.equal(error.name, "AppError");
      assert.equal(error.status, 400);
      assert.equal(error.details?.fieldErrors?.file, "Uploaded file is required.");
      return true;
    }
  );
});
