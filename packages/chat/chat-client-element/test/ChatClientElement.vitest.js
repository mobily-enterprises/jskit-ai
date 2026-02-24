import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ChatClientElement from "../src/ChatClientElement.vue";

if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.scrollTo !== "function") {
  HTMLElement.prototype.scrollTo = function scrollTo() {};
}

function mountElement(options) {
  return mount(ChatClientElement, {
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
    workspaceRoomError: "",
    actionError: "",
    messagesError: "",
    inboxError: "",
    loadingMoreMessages: false,
    selectedThreadId: 11,
    hasMoreMessages: false,
    inWorkspaceRoom: false,
    dmPending: false,
    workspaceRoomPending: false,
    messageRows: [
      {
        id: 1,
        isMine: true,
        groupStart: true,
        groupEnd: true,
        showAvatar: false,
        showMeta: true,
        senderLabel: "You",
        senderAvatarUrl: "",
        message: {
          sentAt: "2026-02-20T00:00:00.000Z",
          text: "Hi",
          attachments: []
        }
      }
    ],
    composerError: "",
    messagesLoading: false,
    typingNotice: "Alex is typing",
    sendPending: false,
    canSend: true,
    composerText: "hello",
    composerAttachments: [
      {
        localId: "a1",
        fileName: "notes.txt",
        sizeBytes: 12,
        status: "queued"
      }
    ],
    dmCandidatesError: "",
    dmCandidatesLoading: false,
    dmCandidates: [
      {
        userId: 42,
        displayName: "Alex",
        avatarUrl: "",
        publicChatId: "u42",
        sharedWorkspaceCount: 1
      }
    ],
    latestMessage: {
      id: 2
    }
  };

  const actions = {
    loadOlderMessages: vi.fn(async () => {}),
    backToWorkspaceRoom: vi.fn(async () => {}),
    refreshInbox: vi.fn(async () => {}),
    refreshThread: vi.fn(async () => {}),
    sendFromComposer: vi.fn(async () => {}),
    handleComposerKeydown: vi.fn(),
    addComposerFiles: vi.fn(async () => {}),
    retryComposerAttachment: vi.fn(async () => {}),
    removeComposerAttachment: vi.fn(async () => {}),
    refreshDmCandidates: vi.fn(async () => {}),
    ensureDmThread: vi.fn(async () => 99)
  };

  return {
    meta: {
      attachmentMaxUploadBytes: 1024,
      attachmentMaxFilesPerMessage: 4,
      dmCandidatesPageSize: 25
    },
    state,
    helpers: {
      formatTimestamp: vi.fn(() => "just now"),
      formatMessageText: vi.fn((message) => String(message?.text || ""))
    },
    actions,
    ...overrides
  };
}

describe("ChatClientElement", () => {
  it("renders core chat surface and controls", () => {
    const wrapper = mountElement({ props: createBaseProps() });

    expect(wrapper.text()).toContain("Load older");
    expect(wrapper.text()).toContain("Start DM");
    expect(wrapper.text()).toContain("Send");
    expect(wrapper.text()).toContain("Alex is typing");
  });

  it("emits chat domain events and invokes actions", async () => {
    const props = createBaseProps();
    const wrapper = mountElement({ props });

    await wrapper.get('[data-testid="chat-send-button"]').trigger("click");
    await wrapper.get('[data-testid="chat-start-dm-button"]').trigger("click");
    const fileInput = wrapper.get('[data-testid="chat-composer-file-input"]');
    Object.defineProperty(fileInput.element, "files", {
      configurable: true,
      value: [new File(["hello"], "hello.txt", { type: "text/plain" })]
    });
    await fileInput.trigger("change");

    expect(props.actions.sendFromComposer).toHaveBeenCalledTimes(1);
    expect(props.actions.refreshDmCandidates).toHaveBeenCalledTimes(1);
    expect(props.actions.addComposerFiles).toHaveBeenCalledTimes(1);

    expect(wrapper.emitted("message:send")?.length).toBe(1);
    expect(wrapper.emitted("dm:open")?.length).toBe(1);
    expect(wrapper.emitted("attachment:add")?.length).toBe(1);
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
        "thread-tools-extra": "<div data-testid='thread-tools-extra-slot'>Extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="thread-tools-extra-slot"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("chat-client-element--layout-compact");
    expect(wrapper.classes()).toContain("chat-client-element--surface-plain");
  });
});
