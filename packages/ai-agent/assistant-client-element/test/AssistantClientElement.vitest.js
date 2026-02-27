import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AssistantClientElement from "../src/shared/AssistantClientElement.vue";

function mountElement(options) {
  return mount(AssistantClientElement, {
    global: {
      config: {
        warnHandler: () => {}
      }
    },
    ...options
  });
}

function createBaseProps(overrides = {}) {
  const state = {
    messages: ref([
      {
        id: "m1",
        role: "user",
        kind: "chat",
        text: "Hello",
        status: "done"
      }
    ]),
    input: ref("ping"),
    isStreaming: ref(false),
    isRestoringConversation: ref(false),
    error: ref(""),
    pendingToolEvents: ref([
      {
        id: "tool_1",
        name: "workspace_rename",
        status: "done"
      }
    ]),
    conversationId: ref("12"),
    conversationHistory: ref([
      {
        id: 12,
        title: "Sprint plan",
        status: "done",
        startedAt: "2026-02-20T00:00:00.000Z",
        messageCount: 3,
        createdByUserDisplayName: "Alex"
      }
    ]),
    conversationHistoryLoading: ref(false),
    conversationHistoryError: ref(""),
    isAdminSurface: ref(false),
    canSend: ref(true),
    canStartNewConversation: ref(true)
  };

  const actions = {
    sendMessage: vi.fn(async () => {}),
    handleInputKeydown: vi.fn(),
    cancelStream: vi.fn(async () => {}),
    startNewConversation: vi.fn(async () => {}),
    selectConversation: vi.fn(async () => {}),
    refreshConversationHistory: vi.fn(async () => {})
  };

  return {
    meta: {
      formatConversationStartedAt: vi.fn(() => "Feb 20"),
      normalizeConversationStatus: vi.fn(() => "done")
    },
    state,
    actions,
    viewer: {
      displayName: "Jordan Doe",
      avatarUrl: ""
    },
    ...overrides
  };
}

describe("AssistantClientElement", () => {
  it("renders assistant panels and composer", () => {
    const wrapper = mountElement({ props: createBaseProps() });

    expect(wrapper.text()).toContain("Conversation History");
    expect(wrapper.text()).toContain("Tool Timeline");
    expect(wrapper.text()).toContain("Send");
  });

  it("emits assistant domain events and calls actions", async () => {
    const props = createBaseProps();
    const wrapper = mountElement({ props });

    await wrapper.get('[data-testid="assistant-send-button"]').trigger("click");

    const startButton = wrapper.findAll("v-btn").find((node) => node.text().includes("Start new conversation"));
    expect(startButton).toBeTruthy();
    await startButton.trigger("click");

    expect(props.actions.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.actions.startNewConversation).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("message:send")?.length).toBe(1);
    expect(wrapper.emitted("conversation:start")?.length).toBe(1);
    expect(wrapper.emitted("interaction")?.length).toBeGreaterThan(0);
  });

  it("supports slots and variant classes", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      }),
      slots: {
        "history-header-extra": "<div data-testid='history-header-extra-slot'>Extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="history-header-extra-slot"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("assistant-client-element--layout-compact");
    expect(wrapper.classes()).toContain("assistant-client-element--surface-plain");
  });
});
