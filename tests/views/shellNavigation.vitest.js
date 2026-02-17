import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShellNavigation } from "../../src/shells/shared/useShellNavigation.js";

function mountHarness({
  initialPath = "/w/acme",
  isMobile = false,
  showShell = true
} = {}) {
  const currentPath = ref(initialPath);
  const showApplicationShell = ref(showShell);
  const mobileRef = ref(isMobile);
  const navigate = vi.fn(async () => undefined);

  const Harness = defineComponent({
    name: "ShellNavigationHarness",
    setup() {
      return {
        vm: useShellNavigation({
          currentPath,
          navigate,
          showApplicationShell,
          display: {
            smAndDown: mobileRef
          }
        }),
        currentPath,
        showApplicationShell,
        mobileRef,
        navigate
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useShellNavigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/w/acme");
  });

  it("handles desktop/mobile drawer state and toggle behavior", async () => {
    const wrapper = mountHarness({ isMobile: false, showShell: true });
    const { state, actions } = wrapper.vm.vm;

    expect(state.drawerModel.value).toBe(true);

    actions.toggleDrawer();
    expect(state.drawerModel.value).toBe(false);

    wrapper.vm.mobileRef = true;
    await nextTick();
    expect(state.drawerModel.value).toBe(false);

    actions.toggleDrawer();
    expect(state.drawerModel.value).toBe(true);

    wrapper.vm.showApplicationShell = false;
    await nextTick();
    expect(state.drawerModel.value).toBe(false);

    actions.toggleDrawer();
    expect(state.drawerModel.value).toBe(false);

    state.drawerModel.value = true;
    expect(state.drawerModel.value).toBe(false);

    wrapper.vm.showApplicationShell = true;
    wrapper.vm.mobileRef = false;
    await nextTick();
    state.drawerModel.value = true;
    expect(state.drawerModel.value).toBe(true);
  });

  it("navigates and closes drawer according to route conditions", async () => {
    const wrapper = mountHarness({ isMobile: true, showShell: true });
    const { state, actions } = wrapper.vm.vm;

    state.drawerModel.value = true;

    await actions.goTo("");
    expect(wrapper.vm.navigate).not.toHaveBeenCalled();

    await actions.goTo("/w/acme");
    expect(wrapper.vm.navigate).not.toHaveBeenCalled();
    expect(state.drawerModel.value).toBe(false);

    state.drawerModel.value = true;
    await actions.goTo("/w/acme/choice-2");
    expect(wrapper.vm.navigate).toHaveBeenCalledWith({ to: "/w/acme/choice-2" });
    expect(state.drawerModel.value).toBe(false);

    expect(actions.isCurrentPath("/w/acme")).toBe(true);
  });

  it("supports hard navigation and forceReload navigation items", async () => {
    const wrapper = mountHarness({ isMobile: false, showShell: true });
    const { actions } = wrapper.vm.vm;
    await actions.hardNavigate("");
    expect(wrapper.vm.navigate).not.toHaveBeenCalled();

    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      await actions.hardNavigate("/admin/w/acme/settings");
      expect(wrapper.vm.navigate).toHaveBeenCalledWith({ to: "/admin/w/acme/settings" });

      await actions.goToNavigationItem({ to: "/admin/w/acme/settings", forceReload: true });
      expect(wrapper.vm.navigate).toHaveBeenCalledWith({ to: "/admin/w/acme/settings" });
    } finally {
      vi.stubGlobal("window", originalWindow);
    }

    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        assign
      }
    });
    try {
      await actions.hardNavigate("/admin/w/acme/settings");
      expect(assign).toHaveBeenCalledWith("/admin/w/acme/settings");
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });
});
