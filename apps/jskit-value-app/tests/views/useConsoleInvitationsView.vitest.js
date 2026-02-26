import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerPathname: "/console/invitations",
  navigate: vi.fn(async () => undefined),
  handleUnauthorizedError: vi.fn(async () => false),
  consoleStore: {
    pendingInvites: [],
    hasAccess: false,
    refreshBootstrap: vi.fn(async () => undefined),
    respondToPendingInvite: vi.fn(async () => undefined)
  }
}));

vi.mock("@tanstack/vue-router", async () => {
  const vue = await import("vue");

  return {
    useNavigate: () => mocks.navigate,
    useRouterState: ({ select }) => {
      const state = {
        location: {
          pathname: mocks.routerPathname
        }
      };

      return vue.ref(typeof select === "function" ? select(state) : state);
    }
  };
});

vi.mock("../../src/app/state/consoleStore.js", () => ({
  useConsoleStore: () => mocks.consoleStore
}));

vi.mock("../../src/modules/auth/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

import { useConsoleInvitationsView } from "../../src/views/console/useConsoleInvitationsView.js";

function unauthorizedError(message) {
  return Object.assign(new Error(message || "Unauthorized"), {
    status: 401
  });
}

function mountHarness() {
  const Harness = defineComponent({
    name: "UseConsoleInvitationsViewHarness",
    setup() {
      return {
        vm: useConsoleInvitationsView()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useConsoleInvitationsView", () => {
  beforeEach(() => {
    mocks.routerPathname = "/console/invitations";
    mocks.navigate.mockReset();

    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);

    mocks.consoleStore.pendingInvites = [
      {
        id: 1,
        token: "invite-token"
      }
    ];
    mocks.consoleStore.hasAccess = false;
    mocks.consoleStore.refreshBootstrap.mockReset();
    mocks.consoleStore.refreshBootstrap.mockResolvedValue(undefined);
    mocks.consoleStore.respondToPendingInvite.mockReset();
    mocks.consoleStore.respondToPendingInvite.mockResolvedValue(undefined);
  });

  it("suppresses bootstrap error message when unauthorized handler consumes 401", async () => {
    mocks.consoleStore.refreshBootstrap.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    const wrapper = mountHarness();
    await flush();

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.feedback.message).toBe("");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("suppresses accept-invite error message when unauthorized handler consumes 401", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.consoleStore.respondToPendingInvite.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.vm.actions.acceptInvite({
      token: "invite-token"
    });

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.feedback.message).toBe("");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("suppresses refuse-invite error message when unauthorized handler consumes 401", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.consoleStore.respondToPendingInvite.mockRejectedValueOnce(unauthorizedError("session expired"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    await wrapper.vm.vm.actions.refuseInvite({
      token: "invite-token"
    });

    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.feedback.message).toBe("");
  });
});
