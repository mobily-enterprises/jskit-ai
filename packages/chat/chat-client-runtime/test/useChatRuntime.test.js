import test from "node:test";
import assert from "node:assert/strict";
import { createChatRuntime, chatRuntimeTestables } from "../src/shared/useChatRuntime.js";

function createPolicy(seed = 0) {
  return {
    messageMaxChars: 4000 + seed,
    attachmentMaxFilesPerMessage: 5 + seed,
    attachmentMaxUploadBytes: 20_000_000 + seed
  };
}

test("chat runtime normalizes thread ids and public chat ids", () => {
  assert.equal(chatRuntimeTestables.normalizeThreadId(42), 42);
  assert.equal(chatRuntimeTestables.normalizeThreadId("x"), 0);
  assert.equal(chatRuntimeTestables.normalizePublicChatId("  USER-ABC  "), "user-abc");
  assert.equal(chatRuntimeTestables.normalizePublicChatId(""), "");
});

test("chat runtime flattens thread pages without duplicate ids", () => {
  const flattened = chatRuntimeTestables.flattenThreadPages([
    {
      items: [{ id: 3 }, { id: 2 }]
    },
    {
      items: [{ id: 2 }, { id: 1 }]
    }
  ]);

  assert.deepEqual(
    flattened.map((entry) => entry.id),
    [3, 2, 1]
  );
});

test("chat runtime flattens message pages chronologically and de-duplicates ids", () => {
  const flattened = chatRuntimeTestables.flattenMessagePagesChronologically([
    {
      items: [{ id: 30 }, { id: 31 }]
    },
    {
      items: [{ id: 31 }, { id: 32 }]
    }
  ]);

  assert.deepEqual(
    flattened.map((entry) => entry.id),
    [31, 32, 30]
  );
});

test("chat runtime buildMessageRows groups adjacent messages by sender and time window", () => {
  const rows = chatRuntimeTestables.buildMessageRows(
    [
      {
        id: 1,
        senderUserId: 5,
        sentAt: "2026-02-23T00:00:00.000Z",
        text: "a"
      },
      {
        id: 2,
        senderUserId: 5,
        sentAt: "2026-02-23T00:03:00.000Z",
        text: "b"
      },
      {
        id: 3,
        senderUserId: 7,
        sentAt: "2026-02-23T00:04:00.000Z",
        text: "c"
      }
    ],
    {
      currentUserId: 5,
      currentUserLabel: "You"
    }
  );

  assert.equal(rows[0].isMine, true);
  assert.equal(rows[0].groupStart, true);
  assert.equal(rows[0].groupEnd, false);
  assert.equal(rows[1].groupStart, false);
  assert.equal(rows[1].groupEnd, true);
  assert.equal(rows[2].isMine, false);
});

test("chat runtime policy resolver requires positive integer fields", () => {
  const policy = chatRuntimeTestables.resolveChatRuntimePolicy({
    messageMaxChars: "4000",
    attachmentMaxFilesPerMessage: 8,
    attachmentMaxUploadBytes: "25000000"
  });
  assert.deepEqual(policy, {
    messageMaxChars: 4000,
    attachmentMaxFilesPerMessage: 8,
    attachmentMaxUploadBytes: 25_000_000
  });
  assert.equal(Object.isFrozen(policy), true);

  assert.throws(
    () => chatRuntimeTestables.resolveChatRuntimePolicy(null),
    /missing required policy object/i
  );
  assert.throws(
    () =>
      chatRuntimeTestables.resolveChatRuntimePolicy({
        messageMaxChars: 0,
        attachmentMaxFilesPerMessage: 5,
        attachmentMaxUploadBytes: 1
      }),
    /policy fields must be positive integers: messageMaxChars/i
  );
});

test("chat runtime factory returns isolated runtime instances", () => {
  const createApi = (seed) => ({
    chat: {
      ensureDm: async () => ({ thread: { id: seed } }),
      listInbox: async () => ({ items: [], nextCursor: null }),
      listThreadMessages: async () => ({ items: [], nextCursor: null }),
      sendThreadMessage: async () => ({ idempotencyStatus: "created" }),
      markThreadRead: async () => ({ lastReadSeq: 1 }),
      reserveThreadAttachment: async () => ({ attachment: { id: seed * 100 } }),
      uploadThreadAttachment: async () => ({ attachment: { id: seed * 100 } }),
      deleteThreadAttachment: async () => ({ ok: true })
    }
  });

  const runtimeA = createChatRuntime({
    api: createApi(1),
    useAuthGuard: () => ({ handleUnauthorizedError: async () => false }),
    useQueryErrorMessage: () => "",
    useWorkspaceStore: () => ({ initialized: true, hasActiveWorkspace: true, can: () => true, activeWorkspaceSlug: "a" }),
    subscribeRealtimeEvents: () => () => {},
    realtimeEventTypes: {
      CHAT_TYPING_STARTED: "chat.typing.started",
      CHAT_TYPING_STOPPED: "chat.typing.stopped"
    },
    policy: createPolicy(0)
  });
  const runtimeB = createChatRuntime({
    api: createApi(2),
    useAuthGuard: () => ({ handleUnauthorizedError: async () => false }),
    useQueryErrorMessage: () => "",
    useWorkspaceStore: () => ({ initialized: true, hasActiveWorkspace: true, can: () => true, activeWorkspaceSlug: "b" }),
    subscribeRealtimeEvents: () => () => {},
    realtimeEventTypes: {
      CHAT_TYPING_STARTED: "custom.started",
      CHAT_TYPING_STOPPED: "custom.stopped"
    },
    policy: createPolicy(3)
  });

  assert.notEqual(runtimeA.useChatRuntime, runtimeB.useChatRuntime);
  assert.equal(runtimeA.useChatView, runtimeA.useChatRuntime);
  assert.equal(runtimeB.useChatView, runtimeB.useChatRuntime);
  assert.equal(runtimeA.chatRuntimeTestables, chatRuntimeTestables);
  assert.equal(runtimeB.chatRuntimeTestables, chatRuntimeTestables);
});

test("chat runtime factory requires policy", () => {
  assert.throws(
    () =>
      createChatRuntime({
        api: {
          chat: {
            ensureDm: async () => ({ thread: { id: 1 } }),
            listInbox: async () => ({ items: [], nextCursor: null }),
            listThreadMessages: async () => ({ items: [], nextCursor: null }),
            sendThreadMessage: async () => ({ idempotencyStatus: "created" }),
            markThreadRead: async () => ({ lastReadSeq: 1 }),
            reserveThreadAttachment: async () => ({ attachment: { id: 100 } }),
            uploadThreadAttachment: async () => ({ attachment: { id: 100 } }),
            deleteThreadAttachment: async () => ({ ok: true })
          }
        }
      }),
    /missing required policy object/i
  );
});
