import { computed, defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locationSearch: {},
  chatView: {
    meta: {},
    state: {},
    helpers: {},
    actions: {
      selectThread: vi.fn(async () => undefined),
      ensureDmThread: vi.fn(async () => undefined)
    }
  }
}));

vi.mock("@tanstack/vue-router", () => ({
  useRouterState: ({ select }) =>
    computed(() =>
      select({
        location: {
          search: mocks.locationSearch
        }
      })
    )
}));

vi.mock("../../src/modules/chat/runtime.js", () => ({
  useChatView: () => mocks.chatView
}));

import { useWorkspaceChatView } from "../../src/views/chat/useWorkspaceChatView.js";

const Harness = defineComponent({
  name: "WorkspaceChatViewHarness",
  setup() {
    return useWorkspaceChatView();
  },
  template: "<div />"
});

describe("useWorkspaceChatView", () => {
  beforeEach(() => {
    mocks.locationSearch = {};
    mocks.chatView.actions.selectThread.mockReset();
    mocks.chatView.actions.ensureDmThread.mockReset();
    mocks.chatView.actions.selectThread.mockResolvedValue(undefined);
    mocks.chatView.actions.ensureDmThread.mockResolvedValue(undefined);
  });

  it("selects thread when threadId search param is present", async () => {
    mocks.locationSearch = {
      threadId: "19"
    };

    mount(Harness);
    await nextTick();
    await nextTick();

    expect(mocks.chatView.actions.selectThread).toHaveBeenCalledWith(19);
    expect(mocks.chatView.actions.ensureDmThread).not.toHaveBeenCalled();
  });

  it("ensures dm thread when dmPublicChatId search param is present", async () => {
    mocks.locationSearch = {
      dmPublicChatId: "Alice123"
    };

    mount(Harness);
    await nextTick();
    await nextTick();

    expect(mocks.chatView.actions.selectThread).not.toHaveBeenCalled();
    expect(mocks.chatView.actions.ensureDmThread).toHaveBeenCalledWith("alice123");
  });

  it("runs handoff once for a single resolved search payload", async () => {
    mocks.locationSearch = {
      threadId: "22"
    };

    mount(Harness);
    await nextTick();
    await nextTick();

    expect(mocks.chatView.actions.selectThread).toHaveBeenCalledTimes(1);
  });
});
