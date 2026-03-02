import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerPathname: "/admin/w/acme/social",
  navigate: vi.fn(async () => undefined),
  ensureDm: vi.fn(async () => ({ thread: { id: 77 } })),
  workspaceStore: {
    activeWorkspaceSlug: "acme",
    can: vi.fn(() => true)
  },
  socialState: null,
  socialActions: null
}));

function createMockSocialState() {
  return {
    composerText: ref(""),
    composerVisibility: ref("public"),
    commentDrafts: reactive({}),
    actorSearchText: ref(""),
    notificationsUnreadOnly: ref(false),
    feedQuery: {
      isFetching: ref(false)
    },
    notificationsQuery: {
      isFetching: ref(false)
    },
    actorSearchQuery: {
      isFetching: ref(false)
    },
    feedItems: ref([]),
    notifications: ref([]),
    actorResults: ref([]),
    createPostMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ post: {} }))
    },
    deletePostMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ deleted: true }))
    },
    createCommentMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ comment: {} }))
    },
    deleteCommentMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ deleted: true }))
    },
    requestFollowMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ follow: {} }))
    },
    undoFollowMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ follow: {} }))
    },
    markNotificationsReadMutation: {
      isPending: ref(false),
      mutateAsync: vi.fn(async () => ({ updated: true, notificationIds: [] }))
    },
    errorMessage: ref("")
  };
}

function createMockSocialActions() {
  return {
    submitPost: vi.fn(async () => ({ post: {} })),
    submitComment: vi.fn(async () => ({ comment: {} })),
    markAllNotificationsRead: vi.fn(async () => ({ updated: true, notificationIds: [] })),
    refreshAll: vi.fn(async () => undefined)
  };
}

vi.mock("@tanstack/vue-router", async () => {
  const vue = await import("vue");
  return {
    useNavigate: () => mocks.navigate,
    useRouterState: (options) =>
      vue.computed(() =>
        options?.select
          ? options.select({
              location: {
                pathname: mocks.routerPathname
              }
            })
          : {
              location: {
                pathname: mocks.routerPathname
              }
            }
      )
  };
});

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: {
    chat: {
      ensureDm: (...args) => mocks.ensureDm(...args)
    }
  }
}));

vi.mock("../../src/app/state/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/modules/social/runtime.js", () => ({
  useSocialView: () => ({
    state: mocks.socialState,
    actions: mocks.socialActions
  })
}));

import { useSocialFeedView } from "../../src/views/social/useSocialFeedView.js";

const Harness = defineComponent({
  name: "SocialFeedViewHarness",
  setup() {
    return useSocialFeedView();
  },
  template: "<div />"
});

describe("useSocialFeedView", () => {
  beforeEach(() => {
    mocks.routerPathname = "/admin/w/acme/social";
    mocks.navigate.mockReset();
    mocks.ensureDm.mockReset();
    mocks.ensureDm.mockResolvedValue({ thread: { id: 77 } });
    mocks.workspaceStore.activeWorkspaceSlug = "acme";
    mocks.workspaceStore.can.mockReset();
    mocks.workspaceStore.can.mockImplementation((permission) => ["social.read", "chat.read", "chat.write"].includes(permission));
    mocks.socialState = createMockSocialState();
    mocks.socialActions = createMockSocialActions();
  });

  it("starts DM for local actors and navigates to chat handoff route", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    await wrapper.vm.actions.startDmForActor({
      id: 42,
      isLocal: true,
      publicChatId: "User42"
    });

    expect(mocks.ensureDm).toHaveBeenCalledWith({
      targetPublicChatId: "user42"
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/w/acme/chat",
      search: {
        threadId: "77",
        dmPublicChatId: "user42"
      }
    });
  });

  it("rejects DM start for remote actors", async () => {
    const wrapper = mount(Harness);
    await nextTick();

    await wrapper.vm.actions.startDmForActor({
      id: 50,
      isLocal: false,
      publicChatId: ""
    });

    expect(mocks.ensureDm).not.toHaveBeenCalled();
    expect(wrapper.vm.state.actionError).toBe("Direct messages are available only for local users.");
  });
});
