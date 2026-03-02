import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleUnauthorizedError: vi.fn(async () => false),
  api: {
    console: {
      listAiTranscripts: vi.fn(async () => ({
        entries: [],
        total: 0,
        totalPages: 1,
        page: 1,
        pageSize: 20
      })),
      getAiTranscriptMessages: vi.fn(async () => ({
        conversation: null,
        entries: []
      })),
      exportAiTranscripts: vi.fn(async () => ({}))
    }
  }
}));

vi.mock("../../src/modules/auth/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: mocks.api
}));

import { useConsoleAiTranscriptsView } from "../../src/views/console/useConsoleAiTranscriptsView.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "UseConsoleAiTranscriptsHarness",
    setup() {
      return {
        vm: useConsoleAiTranscriptsView()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

function unauthorizedError(message) {
  return Object.assign(new Error(message || "Unauthorized"), {
    status: 401
  });
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useConsoleAiTranscriptsView", () => {
  beforeEach(() => {
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);

    mocks.api.console.listAiTranscripts.mockReset();
    mocks.api.console.listAiTranscripts.mockResolvedValue({
      entries: [],
      total: 0,
      totalPages: 1,
      page: 1,
      pageSize: 20
    });

    mocks.api.console.getAiTranscriptMessages.mockReset();
    mocks.api.console.getAiTranscriptMessages.mockResolvedValue({
      conversation: null,
      entries: []
    });

    mocks.api.console.exportAiTranscripts.mockReset();
    mocks.api.console.exportAiTranscripts.mockResolvedValue({});
  });

  it("suppresses list error message when unauthorized handler consumes 401", async () => {
    mocks.api.console.listAiTranscripts.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    const wrapper = mountHarness();
    await flush();

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.state.error).toBe("");
  });

  it("suppresses transcript message error when unauthorized handler consumes 401", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.api.console.getAiTranscriptMessages.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.vm.actions.selectConversation({ id: 7 });

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.state.messagesError).toBe("");
  });

  it("suppresses export error message when unauthorized handler consumes 401", async () => {
    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.state.selectedConversation = { id: 9 };
    mocks.api.console.exportAiTranscripts.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.vm.actions.exportSelection();

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.state.messagesError).toBe("");
  });
});
