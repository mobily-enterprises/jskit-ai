import test from "node:test";
import assert from "node:assert/strict";
import { __testables, createService } from "../src/service.js";

function createNoopDeps() {
  return {
    chatThreadsRepository: {},
    chatParticipantsRepository: {},
    chatMessagesRepository: {},
    chatAttachmentsRepository: {},
    chatReactionsRepository: {},
    chatIdempotencyTombstonesRepository: {},
    chatUserSettingsRepository: {},
    chatBlocksRepository: {},
    chatAttachmentStorageService: {},
    workspaceMembershipsRepository: {},
    userSettingsRepository: {}
  };
}

test("chat service testables create stable idempotency fingerprints", () => {
  const one = __testables.buildMessageIdempotencyFingerprint({
    threadId: 10,
    senderUserId: 5,
    clientMessageId: "abc",
    text: "hello",
    attachmentIds: [2, 1]
  });
  const two = __testables.buildMessageIdempotencyFingerprint({
    threadId: 10,
    senderUserId: 5,
    clientMessageId: "abc",
    text: "hello",
    attachmentIds: [2, 1]
  });
  const three = __testables.buildMessageIdempotencyFingerprint({
    senderUserId: 5,
    clientMessageId: "abc",
    threadId: 10,
    text: "hello",
    attachmentIds: [1, 2]
  });

  assert.equal(one.version, two.version);
  assert.equal(one.sha256, two.sha256);
  assert.notEqual(one.sha256, three.sha256);
});

test("chat service supports injected AppError class", () => {
  class CustomAppError extends Error {
    constructor(status, message, options = {}) {
      super(message);
      this.name = "AppError";
      this.status = Number(status) || 500;
      this.statusCode = this.status;
      this.code = options.code || "APP_ERROR";
      this.details = options.details;
      this.headers = options.headers || {};
    }
  }

  createService({
    ...createNoopDeps(),
    appErrorClass: CustomAppError
  });

  const error = __testables.createFeatureDisabledError();
  assert.equal(error instanceof CustomAppError, true);
  assert.equal(error.status, 403);
  assert.equal(error.code, "CHAT_FEATURE_DISABLED");
});
