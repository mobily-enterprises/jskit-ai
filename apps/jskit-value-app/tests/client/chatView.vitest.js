import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REALTIME_TOPICS } from "../../shared/realtime/eventTypes.js";
import {
  chatInboxInfiniteQueryKey,
  chatThreadMessagesInfiniteQueryKey
} from "../../src/features/chat/queryKeys.js";
import { publishRealtimeEvent, __testables as realtimeEventBusTestables } from "../../src/services/realtime/realtimeEventBus.js";

const mocks = vi.hoisted(() => ({
  api: {
    chat: {
      ensureWorkspaceRoom: vi.fn(),
      listDmCandidates: vi.fn(),
      ensureDm: vi.fn(),
      listInbox: vi.fn(),
      listThreadMessages: vi.fn(),
      sendThreadMessage: vi.fn(),
      markThreadRead: vi.fn(),
      emitThreadTyping: vi.fn(),
      reserveThreadAttachment: vi.fn(),
      uploadThreadAttachment: vi.fn(),
      deleteThreadAttachment: vi.fn()
    }
  },
  workspaceStore: {
    initialized: true,
    hasActiveWorkspace: true,
    activeWorkspaceSlug: "acme",
    sessionUserId: 29,
    can: vi.fn((permission) => permission === "chat.read")
  },
  queryClient: {
    invalidateQueries: vi.fn(async () => undefined)
  },
  handleUnauthorizedError: vi.fn(async () => false),
  infiniteQueryQueue: [],
  inboxQueryState: null,
  messagesQueryState: null
}));

vi.mock("@tanstack/vue-query", () => ({
  useInfiniteQuery: () => {
    if (mocks.infiniteQueryQueue.length < 1) {
      throw new Error("Missing mocked infinite query state.");
    }
    return mocks.infiniteQueryQueue.shift();
  },
  useQueryClient: () => mocks.queryClient
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/composables/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: (...args) => mocks.handleUnauthorizedError(...args)
  })
}));

vi.mock("../../src/composables/useQueryErrorMessage.js", async () => {
  const vue = await import("vue");
  return {
    useQueryErrorMessage: () => vue.ref("")
  };
});

import { useChatView } from "../../src/views/chat/useChatView.js";

function createInfiniteQueryState({
  pages = [{ items: [], nextCursor: null }],
  hasNextPage = false
} = {}) {
  return {
    data: ref({ pages }),
    error: ref(null),
    isPending: ref(false),
    isFetching: ref(false),
    refetch: vi.fn(async () => undefined),
    hasNextPage: ref(hasNextPage),
    isFetchingNextPage: ref(false),
    fetchNextPage: vi.fn(async () => undefined)
  };
}

function buildThread({
  id = 11,
  unreadCount = 0,
  lastReadSeq = 2
} = {}) {
  return {
    id,
    threadKind: "dm",
    title: "Acme DM",
    unreadCount,
    participant: {
      lastReadSeq
    }
  };
}

function buildMessage({ id = 91, threadSeq = 2, text = "hello" } = {}) {
  return {
    id,
    threadSeq,
    text,
    senderUserId: 42,
    sentAt: "2026-02-22T18:00:00.000Z",
    attachments: []
  };
}

const Harness = defineComponent({
  name: "ChatViewHarness",
  setup() {
    return useChatView();
  },
  template: "<div />"
});

describe("useChatView", () => {
  beforeEach(() => {
    mocks.api.chat.ensureWorkspaceRoom.mockReset();
    mocks.api.chat.listInbox.mockReset();
    mocks.api.chat.listThreadMessages.mockReset();
    mocks.api.chat.listDmCandidates.mockReset();
    mocks.api.chat.ensureDm.mockReset();
    mocks.api.chat.sendThreadMessage.mockReset();
    mocks.api.chat.markThreadRead.mockReset();
    mocks.api.chat.emitThreadTyping.mockReset();
    mocks.api.chat.reserveThreadAttachment.mockReset();
    mocks.api.chat.uploadThreadAttachment.mockReset();
    mocks.api.chat.deleteThreadAttachment.mockReset();
    mocks.api.chat.emitThreadTyping.mockResolvedValue({
      accepted: true,
      expiresAt: "2026-02-22T00:00:08.000Z"
    });
    mocks.api.chat.reserveThreadAttachment.mockResolvedValue({
      attachment: {
        id: 7001
      }
    });
    mocks.api.chat.ensureWorkspaceRoom.mockResolvedValue({
      thread: {
        id: 11,
        scopeKind: "workspace",
        workspaceId: 19,
        threadKind: "workspace_room",
        title: "Workspace chat",
        participantCount: 2,
        lastMessageId: null,
        lastMessageSeq: null,
        lastMessageAt: null,
        lastMessagePreview: null,
        createdAt: "2026-02-22T00:00:00.000Z",
        updatedAt: "2026-02-22T00:00:00.000Z",
        unreadCount: 0,
        participant: {
          status: "active",
          lastReadSeq: 0
        },
        peerUser: null
      },
      created: false
    });
    mocks.api.chat.uploadThreadAttachment.mockResolvedValue({
      attachment: {
        id: 7001
      }
    });
    mocks.api.chat.deleteThreadAttachment.mockResolvedValue({
      ok: true
    });
    mocks.api.chat.listDmCandidates.mockResolvedValue({
      items: [
        {
          userId: 42,
          displayName: "Alex",
          avatarUrl: null,
          publicChatId: "u42",
          sharedWorkspaceCount: 1
        }
      ]
    });
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.workspaceStore.initialized = true;
    mocks.workspaceStore.hasActiveWorkspace = true;
    mocks.workspaceStore.activeWorkspaceSlug = "acme";
    mocks.workspaceStore.sessionUserId = 29;
    mocks.workspaceStore.can.mockReset();
    mocks.workspaceStore.can.mockImplementation((permission) => permission === "chat.read");
    realtimeEventBusTestables.listeners.clear();

    const inboxQuery = createInfiniteQueryState({
      pages: [{ items: [buildThread()], nextCursor: null }],
      hasNextPage: true
    });
    const messagesQuery = createInfiniteQueryState({
      pages: [{ items: [buildMessage()], nextCursor: null }],
      hasNextPage: true
    });

    mocks.inboxQueryState = inboxQuery;
    mocks.messagesQueryState = messagesQuery;
    mocks.infiniteQueryQueue = [inboxQuery, messagesQuery];
  });

  it("sends a message and invalidates inbox + message query keys", async () => {
    mocks.api.chat.sendThreadMessage.mockResolvedValueOnce({
      idempotencyStatus: "created"
    });

    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "hello there";
    await wrapper.vm.actions.sendFromComposer();

    expect(mocks.api.chat.sendThreadMessage).toHaveBeenCalledTimes(1);
    const [threadId, payload] = mocks.api.chat.sendThreadMessage.mock.calls[0];
    expect(threadId).toBe(11);
    expect(payload.text).toBe("hello there");
    expect(String(payload.clientMessageId || "").startsWith("cm_")).toBe(true);

    expect(wrapper.vm.state.composerError).toBe("");
    expect(wrapper.vm.state.composerText).toBe("");
    expect(wrapper.vm.state.actionError).toBe("");

    expect(mocks.queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: chatThreadMessagesInfiniteQueryKey("acme", 11, { limit: 50 })
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: chatInboxInfiniteQueryKey("acme", { limit: 20 })
    });
  });

  it("keeps composer quiet when server returns idempotency replay", async () => {
    mocks.api.chat.sendThreadMessage.mockResolvedValueOnce({
      idempotencyStatus: "replayed"
    });

    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "same payload";
    await wrapper.vm.actions.sendFromComposer();

    expect(wrapper.vm.state.composerError).toBe("");
    expect(wrapper.vm.state.actionError).toBe("");
  });

  it("maps CHAT_IDEMPOTENCY_CONFLICT to deterministic error copy", async () => {
    mocks.api.chat.sendThreadMessage.mockRejectedValueOnce({
      status: 409,
      message: "conflict",
      details: {
        code: "CHAT_IDEMPOTENCY_CONFLICT"
      }
    });

    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "conflicting";
    await wrapper.vm.actions.sendFromComposer();

    expect(wrapper.vm.state.composerError).toBe("Duplicate message id conflicts with different content.");
    expect(wrapper.vm.state.actionError).toBe("");
    expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("uses load-more actions for both inbox and message history", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    await wrapper.vm.actions.loadMoreThreads();
    await wrapper.vm.actions.loadOlderMessages();

    expect(mocks.inboxQueryState.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(mocks.messagesQueryState.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("ensures workspace room on mount and selects it by default", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    expect(mocks.api.chat.ensureWorkspaceRoom).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.state.selectedThreadId).toBe(11);
    expect(wrapper.vm.state.inWorkspaceRoom).toBe(true);
  });

  it("sends on Enter when sendOnEnter is enabled", async () => {
    mocks.api.chat.sendThreadMessage.mockResolvedValueOnce({
      idempotencyStatus: "created"
    });

    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "enter-send";
    const event = {
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn()
    };

    wrapper.vm.actions.handleComposerKeydown(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.api.chat.sendThreadMessage).toHaveBeenCalledTimes(1);
  });

  it("creates or opens dm via ensureDmThread and selects resulting thread", async () => {
    mocks.api.chat.ensureDm.mockResolvedValueOnce({
      created: true,
      thread: {
        id: 55
      }
    });
    mocks.inboxQueryState.refetch.mockImplementationOnce(async () => {
      mocks.inboxQueryState.data.value = {
        pages: [
          {
            items: [buildThread({ id: 55 }), buildThread({ id: 11 })],
            nextCursor: null
          }
        ]
      };
    });

    const wrapper = mount(Harness);
    await nextTick();

    const threadId = await wrapper.vm.actions.ensureDmThread("u55");

    expect(threadId).toBe(55);
    expect(mocks.api.chat.ensureDm).toHaveBeenCalledWith({
      targetPublicChatId: "u55"
    });
    expect(mocks.inboxQueryState.refetch).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.state.selectedThreadId).toBe(55);
    expect(wrapper.vm.state.composerError).toBe("");
  });

  it("supports returning to workspace room after switching threads", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    await wrapper.vm.actions.selectThread(55);
    await wrapper.vm.actions.backToWorkspaceRoom();

    expect(wrapper.vm.state.selectedThreadId).toBe(11);
  });

  it("loads direct-message candidates and exposes normalized entries", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    const candidates = await wrapper.vm.actions.refreshDmCandidates({
      search: "alex",
      limit: 8
    });

    expect(mocks.api.chat.listDmCandidates).toHaveBeenCalledWith({
      q: "alex",
      limit: 8
    });
    expect(Array.isArray(candidates)).toBe(true);
    expect(wrapper.vm.state.dmCandidates).toHaveLength(1);
    expect(wrapper.vm.state.dmCandidates[0]).toEqual({
      userId: 42,
      displayName: "Alex",
      avatarUrl: "",
      publicChatId: "u42",
      sharedWorkspaceCount: 1
    });
  });

  it("uploads attachments and supports attachment-only sends", async () => {
    mocks.api.chat.sendThreadMessage.mockResolvedValueOnce({
      idempotencyStatus: "created"
    });

    const wrapper = mount(Harness);
    await nextTick();

    const file = new File(["hello"], "hello.txt", {
      type: "text/plain"
    });

    const added = await wrapper.vm.actions.addComposerFiles([file]);

    expect(added).toBe(1);
    expect(mocks.api.chat.reserveThreadAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.api.chat.reserveThreadAttachment).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        fileName: "hello.txt",
        mimeType: "text/plain",
        kind: "file"
      })
    );
    expect(mocks.api.chat.uploadThreadAttachment).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.state.composerAttachments).toHaveLength(1);
    expect(wrapper.vm.state.composerAttachments[0].status).toBe("uploaded");

    await wrapper.vm.actions.sendFromComposer();

    expect(mocks.api.chat.sendThreadMessage).toHaveBeenCalledTimes(1);
    const [threadId, payload] = mocks.api.chat.sendThreadMessage.mock.calls[0];
    expect(threadId).toBe(11);
    expect(payload.text).toBeUndefined();
    expect(payload.attachmentIds).toEqual([7001]);
    expect(wrapper.vm.state.composerAttachments).toHaveLength(0);
  });

  it("blocks send while failed attachment states remain unresolved", async () => {
    mocks.api.chat.reserveThreadAttachment.mockRejectedValueOnce({
      status: 409,
      message: "conflict",
      details: {
        code: "CHAT_ATTACHMENT_CONFLICT"
      }
    });

    const wrapper = mount(Harness);
    await nextTick();

    const file = new File(["mismatch"], "conflict.txt", {
      type: "text/plain"
    });
    const added = await wrapper.vm.actions.addComposerFiles([file]);

    expect(added).toBe(1);
    expect(wrapper.vm.state.composerAttachments).toHaveLength(1);
    expect(wrapper.vm.state.composerAttachments[0].status).toBe("failed");
    expect(wrapper.vm.state.composerAttachments[0].errorMessage).toBe("Attachment state changed. Try uploading again.");

    wrapper.vm.state.composerText = "hello";
    await wrapper.vm.actions.sendFromComposer();

    expect(wrapper.vm.state.composerError).toBe("Resolve attachment uploads before sending.");
    expect(mocks.api.chat.sendThreadMessage).not.toHaveBeenCalled();
  });

  it("removes uploaded composer attachments and calls staged delete endpoint", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    const file = new File(["bye"], "remove.txt", {
      type: "text/plain"
    });
    await wrapper.vm.actions.addComposerFiles([file]);

    expect(wrapper.vm.state.composerAttachments).toHaveLength(1);
    const localId = wrapper.vm.state.composerAttachments[0].localId;
    await wrapper.vm.actions.removeComposerAttachment(localId);

    expect(wrapper.vm.state.composerAttachments).toHaveLength(0);
    expect(mocks.api.chat.deleteThreadAttachment).toHaveBeenCalledWith(11, 7001);
  });

  it("emits typing heartbeat while composing", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "typing now";
    await nextTick();
    await Promise.resolve();

    expect(mocks.api.chat.emitThreadTyping).toHaveBeenCalledWith(11);
  });

  it("shows typing notice from realtime typing events", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    publishRealtimeEvent({
      eventId: "evt-typing-started",
      eventType: "chat.typing.started",
      topic: REALTIME_TOPICS.TYPING,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      payload: {
        threadId: 11,
        userId: 42,
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    });

    await nextTick();
    expect(wrapper.vm.state.typingNotice).toBe("User #42 is typing...");
  });

  it("formats multi-user typing notice with names", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    for (const userId of [42, 43, 44]) {
      publishRealtimeEvent({
        eventId: `evt-typing-${userId}`,
        eventType: "chat.typing.started",
        topic: REALTIME_TOPICS.TYPING,
        workspaceSlug: "acme",
        sourceClientId: "cli-remote",
        payload: {
          threadId: 11,
          userId,
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      });
    }

    await nextTick();
    expect(wrapper.vm.state.typingNotice).toBe("User #42, User #43, and User #44 are typing...");
  });
});
