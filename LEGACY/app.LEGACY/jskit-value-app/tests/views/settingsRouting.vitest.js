import { ref, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

import { useSettingsRouting } from "../../src/views/settings/lib/useSettingsRouting.js";

function createRoutingHarness({
  routerPath = "/account/settings",
  routerSearch = { section: "profile" },
  hasActiveWorkspace = true,
  workspacePath = "/w/acme",
  workspacesPath = "/workspaces",
  rootPath = "/",
  surface = "app"
} = {}) {
  const navigate = vi.fn(async () => undefined);
  const routerPathRef = ref(routerPath);
  const routerSearchRef = ref(routerSearch);
  const surfacePaths = ref({
    surface,
    rootPath,
    accountSettingsPath: "/account/settings",
    workspacesPath,
    isAccountSettingsPath: (pathname) => String(pathname || "") === "/account/settings"
  });
  const workspaceStore = {
    hasActiveWorkspace,
    workspacePath: vi.fn(() => workspacePath)
  };

  const vm = useSettingsRouting({
    navigate,
    routerPath: routerPathRef,
    routerSearch: routerSearchRef,
    surfacePaths,
    workspaceStore
  });

  return {
    navigate,
    routerPathRef,
    routerSearchRef,
    surfacePaths,
    workspaceStore,
    vm
  };
}

describe("useSettingsRouting", () => {
  it("syncs tab from URL and navigates when section changes", async () => {
    const harness = createRoutingHarness({
      routerSearch: { section: "preferences", returnTo: "/w/acme" }
    });

    await nextTick();
    expect(harness.vm.activeTab.value).toBe("preferences");

    harness.vm.selectSettingsSection("security");
    await nextTick();

    expect(harness.navigate).toHaveBeenCalledWith({
      to: "/account/settings",
      search: {
        section: "security",
        returnTo: "/w/acme"
      },
      replace: true
    });
  });

  it("computes back target and handles route/search edge cases", async () => {
    const withReturnTo = createRoutingHarness({
      routerSearch: { section: "profile", returnTo: "/w/acme/choice-2" }
    });
    await withReturnTo.vm.goBack();
    expect(withReturnTo.navigate).toHaveBeenCalledWith({
      to: "/w/acme/choice-2"
    });

    const withWorkspaceFallback = createRoutingHarness({
      routerSearch: { section: "profile", returnTo: "/account/settings" },
      hasActiveWorkspace: true,
      workspacePath: "/w/acme"
    });
    await withWorkspaceFallback.vm.goBack();
    expect(withWorkspaceFallback.workspaceStore.workspacePath).toHaveBeenCalledWith("/", { surface: "app" });
    expect(withWorkspaceFallback.navigate).toHaveBeenCalledWith({
      to: "/w/acme"
    });

    const withWorkspacesFallback = createRoutingHarness({
      routerSearch: { section: "profile", returnTo: "https://bad.example" },
      hasActiveWorkspace: false,
      workspacesPath: "/admin/workspaces"
    });
    await withWorkspacesFallback.vm.goBack();
    expect(withWorkspacesFallback.navigate).toHaveBeenCalledWith({
      to: "/admin/workspaces"
    });

    const nonWorkspaceSurfaceFallback = createRoutingHarness({
      routerSearch: { section: "profile", returnTo: "" },
      hasActiveWorkspace: false,
      surface: "console",
      rootPath: "/console",
      workspacesPath: "/console/workspaces"
    });
    await nonWorkspaceSurfaceFallback.vm.goBack();
    expect(nonWorkspaceSurfaceFallback.navigate).toHaveBeenCalledWith({
      to: "/console"
    });
  });

  it("ignores invalid/no-op section updates and non-settings routes", async () => {
    const harness = createRoutingHarness({
      routerPath: "/w/acme",
      routerSearch: { section: "profile" }
    });

    await nextTick();
    expect(harness.vm.activeTab.value).toBe("profile");

    harness.vm.selectSettingsSection("profile");
    harness.vm.selectSettingsSection("invalid-tab");
    await nextTick();
    expect(harness.navigate).not.toHaveBeenCalled();

    harness.routerSearchRef.value = { section: "security" };
    await nextTick();
    expect(harness.vm.activeTab.value).toBe("profile");
  });
});
