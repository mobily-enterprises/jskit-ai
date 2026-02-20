import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    ai: {
      streamChat: vi.fn()
    }
  }
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
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
});
