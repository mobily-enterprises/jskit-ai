import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatInboxInfiniteQueryKey,
  chatThreadMessagesInfiniteQueryKey
} from "../../src/features/chat/queryKeys.js";

const mocks = vi.hoisted(() => ({
  api: {
    chat: {
      listInbox: vi.fn(),
      listThreadMessages: vi.fn(),
      sendThreadMessage: vi.fn(),
      markThreadRead: vi.fn()
    }
  },
  workspaceStore: {
    initialized: true,
    hasActiveWorkspace: true,
    activeWorkspaceSlug: "acme",
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
    mocks.api.chat.listInbox.mockReset();
    mocks.api.chat.listThreadMessages.mockReset();
    mocks.api.chat.sendThreadMessage.mockReset();
    mocks.api.chat.markThreadRead.mockReset();
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.workspaceStore.initialized = true;
    mocks.workspaceStore.hasActiveWorkspace = true;
    mocks.workspaceStore.activeWorkspaceSlug = "acme";
    mocks.workspaceStore.can.mockReset();
    mocks.workspaceStore.can.mockImplementation((permission) => permission === "chat.read");

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

    expect(wrapper.vm.state.sendStatus).toBe("Message sent.");
    expect(wrapper.vm.state.composerText).toBe("");
    expect(wrapper.vm.state.actionError).toBe("");

    expect(mocks.queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: chatThreadMessagesInfiniteQueryKey("acme", 11, { limit: 50 })
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: chatInboxInfiniteQueryKey("acme", { limit: 20 })
    });
  });

  it("shows replay status when server returns idempotency replay", async () => {
    mocks.api.chat.sendThreadMessage.mockResolvedValueOnce({
      idempotencyStatus: "replayed"
    });

    const wrapper = mount(Harness);
    await nextTick();

    wrapper.vm.state.composerText = "same payload";
    await wrapper.vm.actions.sendFromComposer();

    expect(wrapper.vm.state.sendStatus).toBe("Request replayed. Existing message returned.");
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

    expect(wrapper.vm.state.sendStatus).toBe("");
    expect(wrapper.vm.state.actionError).toBe("Duplicate message id conflicts with different content.");
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
});
