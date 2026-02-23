import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    ai: {
      streamChat: vi.fn(),
      listConversations: vi.fn(async () => ({
        entries: []
      })),
      getConversationMessages: vi.fn()
    }
  },
  workspaceStore: {
    initialized: true,
    activeWorkspace: {
      id: 11,
      slug: "acme"
    },
    activeWorkspaceSlug: "acme"
  },
  historyData: null,
  historyError: null,
  historyFetching: null,
  historyRefetch: vi.fn(async () => undefined),
  queryClient: {
    fetchQuery: vi.fn(async ({ queryFn }) => queryFn()),
    invalidateQueries: vi.fn(async () => undefined)
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({
    data: mocks.historyData,
    error: mocks.historyError,
    isFetching: mocks.historyFetching,
    refetch: mocks.historyRefetch
  }),
  useQueryClient: () => mocks.queryClient
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

import { useAssistantView, __testables as assistantViewTestables } from "../../src/views/assistant/useAssistantView.js";

const Harness = defineComponent({
  name: "AssistantViewHarness",
  setup() {
    return useAssistantView();
  },
  template: "<div />"
});

describe("useAssistantView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.api.ai.streamChat.mockReset();
    mocks.api.ai.listConversations.mockReset();
    mocks.api.ai.listConversations.mockResolvedValue({
      entries: []
    });
    mocks.api.ai.getConversationMessages.mockReset();
    mocks.historyData = ref({
      entries: []
    });
    mocks.historyError = ref(null);
    mocks.historyFetching = ref(false);
    mocks.historyRefetch.mockReset();
    mocks.historyRefetch.mockResolvedValue(undefined);
    mocks.queryClient.fetchQuery.mockReset();
    mocks.queryClient.fetchQuery.mockImplementation(async ({ queryFn }) => queryFn());
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
  });

  it("transitions from send to delta to done state", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ type: "assistant_delta", delta: "Hello" });
      handlers.onEvent({ type: "assistant_message", text: "Hello there" });
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hi";

    await wrapper.vm.actions.sendMessage();

    const messages = wrapper.vm.state.messages.value;
    expect(messages[0].role).toBe("user");
    expect(messages[0].text).toBe("hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].text).toBe("Hello there");
    expect(messages[1].status).toBe("done");
    expect(wrapper.vm.state.isStreaming.value).toBe(false);
    expect(wrapper.vm.state.error.value).toBe("");
  });

  it("tracks tool call and tool result timeline entries", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({
        type: "tool_call",
        toolCallId: "call_1",
        name: "workspace_rename",
        arguments: '{"name":"ACME"}'
      });
      handlers.onEvent({
        type: "tool_result",
        toolCallId: "call_1",
        name: "workspace_rename",
        ok: true,
        result: {
          name: "ACME"
        }
      });
      handlers.onEvent({ type: "assistant_message", text: "Renamed." });
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "rename workspace";

    await wrapper.vm.actions.sendMessage();

    expect(wrapper.vm.state.pendingToolEvents.value).toEqual([
      {
        id: "call_1",
        name: "workspace_rename",
        arguments: '{"name":"ACME"}',
        status: "done",
        result: {
          name: "ACME"
        },
        error: null
      }
    ]);

    const textBlob = wrapper.vm.state.messages.value.map((message) => message.text).join(" ");
    expect(textBlob.includes("Tool call")).toBe(true);
    expect(textBlob.includes("Tool result")).toBe(true);
  });

  it("excludes tool timeline rows from model history on subsequent turns", async () => {
    const requestPayloads = [];
    mocks.api.ai.streamChat.mockImplementation(async (payload, handlers) => {
      requestPayloads.push(payload);
      if (requestPayloads.length === 1) {
        handlers.onEvent({
          type: "tool_call",
          toolCallId: "call_1",
          name: "workspace_rename",
          arguments: '{"name":"ACME"}'
        });
        handlers.onEvent({
          type: "tool_result",
          toolCallId: "call_1",
          name: "workspace_rename",
          ok: true,
          result: {
            name: "ACME"
          }
        });
        handlers.onEvent({ type: "assistant_message", text: "Renamed." });
      } else {
        handlers.onEvent({ type: "assistant_message", text: "Second reply." });
      }
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "rename workspace";
    await wrapper.vm.actions.sendMessage();

    wrapper.vm.state.input.value = "what changed?";
    await wrapper.vm.actions.sendMessage();

    expect(requestPayloads).toHaveLength(2);
    expect(requestPayloads[1].history).toEqual([
      {
        role: "user",
        content: "rename workspace"
      },
      {
        role: "assistant",
        content: "Renamed."
      }
    ]);
  });

  it("excludes canceled/error assistant turns from model history", () => {
    const history = assistantViewTestables.buildHistory([
      { role: "user", kind: "chat", text: "first", status: "done" },
      { role: "assistant", kind: "chat", text: "failed response", status: "error" },
      { role: "assistant", kind: "chat", text: "partial response", status: "canceled" },
      { role: "assistant", kind: "chat", text: "still streaming", status: "streaming" },
      { role: "assistant", kind: "chat", text: "good response", status: "done" },
      { role: "assistant", kind: "tool_event", text: "Tool call: workspace_rename", status: "tool_call" }
    ]);

    expect(history).toEqual([
      {
        role: "user",
        content: "first"
      },
      {
        role: "assistant",
        content: "good response"
      }
    ]);
  });

  it("supports canceling an active stream", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      await new Promise((resolve, reject) => {
        handlers.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });

        setTimeout(resolve, 30);
      });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "cancel me";

    const sendPromise = wrapper.vm.actions.sendMessage();
    wrapper.vm.actions.cancelStream();
    await sendPromise;

    expect(wrapper.vm.state.isStreaming.value).toBe(false);
    expect(wrapper.vm.state.error.value).toBe("");
    expect(wrapper.vm.state.messages.value[1].status).toBe("canceled");
  });

  it("finalizes assistant message when stream ends without done event", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ type: "assistant_message", text: "Hello." });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hi";

    await wrapper.vm.actions.sendMessage();

    expect(wrapper.vm.state.messages.value[1].status).toBe("done");
    expect(wrapper.vm.state.messages.value[1].text).toBe("Hello.");
  });

  it("marks empty assistant completion as error", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hi";

    await wrapper.vm.actions.sendMessage();

    expect(wrapper.vm.state.error.value).toBe("Assistant returned no output.");
    expect(wrapper.vm.state.messages.value[1].status).toBe("error");
    expect(wrapper.vm.state.messages.value[1].text).toBe("");
  });

  it("times out stalled streams and marks assistant message as error", async () => {
    vi.useFakeTimers();
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      await new Promise((resolve, reject) => {
        handlers.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });

        setTimeout(resolve, assistantViewTestables.ASSISTANT_STREAM_TIMEOUT_MS * 2);
      });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hi";

    const sendPromise = wrapper.vm.actions.sendMessage();
    await vi.advanceTimersByTimeAsync(assistantViewTestables.ASSISTANT_STREAM_TIMEOUT_MS + 1);
    await sendPromise;

    expect(wrapper.vm.state.error.value).toBe("Assistant request timed out.");
    expect(wrapper.vm.state.messages.value[1].status).toBe("error");
    expect(wrapper.vm.state.isStreaming.value).toBe(false);
  });

  it("sends on enter by default", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ type: "assistant_message", text: "Done." });
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hello";
    const event = {
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn()
    };

    wrapper.vm.actions.handleInputKeydown(event);
    await Promise.resolve();

    const messages = wrapper.vm.state.messages.value;
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(messages[0].text).toBe("hello");
    expect(messages[1].text).toBe("Done.");
  });

  it("does not send on enter when sendOnEnter is disabled", async () => {
    const wrapper = mount(Harness);
    wrapper.vm.state.sendOnEnter.value = false;
    wrapper.vm.state.input.value = "hello";
    const event = {
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn()
    };

    wrapper.vm.actions.handleInputKeydown(event);
    await Promise.resolve();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.api.ai.streamChat).not.toHaveBeenCalled();
    expect(wrapper.vm.state.messages.value).toEqual([]);
  });

  it("restores a conversation and sets active conversation id", async () => {
    mocks.api.ai.getConversationMessages.mockResolvedValueOnce({
      entries: [
        {
          id: 1,
          role: "user",
          kind: "chat",
          contentText: "rename workspace",
          metadata: {}
        },
        {
          id: 2,
          role: "assistant",
          kind: "chat",
          contentText: "Renaming now.",
          metadata: {}
        },
        {
          id: 3,
          role: "assistant",
          kind: "tool_call",
          contentText: '{"name":"ACME"}',
          metadata: {
            toolCallId: "call_1",
            tool: "workspace_rename"
          }
        },
        {
          id: 4,
          role: "tool",
          kind: "tool_result",
          contentText: '{"ok":true,"result":{"name":"ACME"}}',
          metadata: {
            toolCallId: "call_1",
            tool: "workspace_rename"
          }
        }
      ]
    });

    const wrapper = mount(Harness);
    await wrapper.vm.actions.selectConversationById(42);

    expect(wrapper.vm.state.conversationId.value).toBe("42");
    expect(wrapper.vm.state.messages.value.map((entry) => entry.text)).toEqual([
      "rename workspace",
      "Renaming now.",
      "Tool call: workspace_rename",
      "Tool result: workspace_rename completed"
    ]);
    expect(wrapper.vm.state.pendingToolEvents.value).toEqual([
      {
        id: "call_1",
        name: "workspace_rename",
        arguments: '{"name":"ACME"}',
        status: "done",
        result: {
          name: "ACME"
        },
        error: null
      }
    ]);
    expect(mocks.api.ai.getConversationMessages).toHaveBeenCalledWith(42, {
      page: assistantViewTestables.RESTORE_MESSAGES_PAGE,
      pageSize: assistantViewTestables.RESTORE_MESSAGES_PAGE_SIZE
    });
  });

  it("start new conversation clears local state and resets conversation id", () => {
    const wrapper = mount(Harness);
    wrapper.vm.state.messages.value = [
      {
        id: "m1",
        role: "user",
        kind: "chat",
        text: "hello",
        status: "done"
      }
    ];
    wrapper.vm.state.pendingToolEvents.value = [
      {
        id: "call_1",
        name: "workspace_rename",
        arguments: "{}",
        status: "pending",
        result: null,
        error: null
      }
    ];
    wrapper.vm.state.input.value = "draft";
    wrapper.vm.state.error.value = "failed";
    wrapper.vm.state.conversationId.value = "77";

    wrapper.vm.actions.startNewConversation();

    expect(wrapper.vm.state.messages.value).toEqual([]);
    expect(wrapper.vm.state.pendingToolEvents.value).toEqual([]);
    expect(wrapper.vm.state.input.value).toBe("");
    expect(wrapper.vm.state.error.value).toBe("");
    expect(wrapper.vm.state.conversationId.value).toBe(null);
  });

  it("invalidates and refetches conversation history after send", async () => {
    mocks.api.ai.streamChat.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onEvent({ type: "meta", conversationId: "55" });
      handlers.onEvent({ type: "assistant_message", text: "done" });
      handlers.onEvent({ type: "done" });
    });

    const wrapper = mount(Harness);
    wrapper.vm.state.input.value = "hello";

    await wrapper.vm.actions.sendMessage();

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mocks.queryClient.invalidateQueries.mock.calls[0][0]).toEqual({
      queryKey: ["assistant", "id:11"]
    });
    expect(mocks.historyRefetch).toHaveBeenCalledTimes(1);
  });
});
