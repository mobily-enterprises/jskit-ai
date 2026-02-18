import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  api: {
    bootstrap: vi.fn()
  }
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { createSurfaceRouteGuards, resolveRuntimeState } from "../../src/routerGuards.js";
import { useWorkspaceStore } from "../../src/stores/workspaceStore.js";

function buildStores({
  authInitialized = true,
  workspaceInitialized = true,
  authenticated = false,
  hasWorkspace = false,
  workspaceSlug = "",
  canPermissions = []
} = {}) {
  const authStore = {
    initialized: authInitialized,
    isAuthenticated: authenticated,
    applySession: vi.fn(({ authenticated: nextAuthenticated }) => {
      authStore.initialized = true;
      authStore.isAuthenticated = Boolean(nextAuthenticated);
    }),
    setSignedOut: vi.fn(() => {
      authStore.initialized = true;
      authStore.isAuthenticated = false;
    })
  };

  const workspaceStore = {
    initialized: workspaceInitialized,
    hasActiveWorkspace: hasWorkspace,
    activeWorkspaceSlug: workspaceSlug,
    applyBootstrap: vi.fn((payload) => {
      workspaceStore.initialized = true;
      const workspace = payload?.workspace || null;
      workspaceStore.hasActiveWorkspace = Boolean(workspace?.slug);
      workspaceStore.activeWorkspaceSlug = workspace?.slug || "";
    }),
    clearWorkspaceState: vi.fn(() => {
      workspaceStore.initialized = true;
      workspaceStore.hasActiveWorkspace = false;
      workspaceStore.activeWorkspaceSlug = "";
    }),
    selectWorkspace: vi.fn(async (slug) => {
      workspaceStore.hasActiveWorkspace = true;
      workspaceStore.activeWorkspaceSlug = String(slug || "");
    }),
    can: vi.fn((permission) => canPermissions.includes(permission))
  };

  return {
    authStore,
    workspaceStore
  };
}

describe("routerGuards", () => {
  beforeEach(() => {
    mocks.api.bootstrap.mockReset();
  });

  it("resolveRuntimeState uses existing initialized store state", async () => {
    const stores = buildStores({
      authInitialized: true,
      workspaceInitialized: true,
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme"
    });

    const state = await resolveRuntimeState(stores);

    expect(state).toEqual({
      authenticated: true,
      hasActiveWorkspace: true,
      activeWorkspaceSlug: "acme",
      sessionUnavailable: false
    });
    expect(mocks.api.bootstrap).not.toHaveBeenCalled();
  });

  it("resolveRuntimeState bootstraps and maps auth/workspace state", async () => {
    const stores = buildStores({
      authInitialized: false,
      workspaceInitialized: false
    });
    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true
      },
      workspace: {
        slug: "team"
      }
    });

    const state = await resolveRuntimeState(stores);

    expect(mocks.api.bootstrap).toHaveBeenCalledTimes(1);
    expect(stores.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: null
    });
    expect(stores.workspaceStore.applyBootstrap).toHaveBeenCalledTimes(1);
    expect(state.authenticated).toBe(true);
    expect(state.hasActiveWorkspace).toBe(true);
    expect(state.activeWorkspaceSlug).toBe("team");
  });

  it("redirects to workspace list when bootstrap has one inaccessible workspace and no selection", async () => {
    setActivePinia(createPinia());
    const workspaceStore = useWorkspaceStore();
    const authStore = {
      initialized: false,
      isAuthenticated: false,
      applySession: vi.fn(({ authenticated: nextAuthenticated }) => {
        authStore.initialized = true;
        authStore.isAuthenticated = Boolean(nextAuthenticated);
      }),
      setSignedOut: vi.fn(() => {
        authStore.initialized = true;
        authStore.isAuthenticated = false;
      })
    };
    const stores = { authStore, workspaceStore };

    mocks.api.bootstrap.mockResolvedValue({
      session: {
        authenticated: true
      },
      workspaces: [
        {
          id: 9,
          slug: "blocked",
          name: "Blocked",
          isAccessible: false
        }
      ],
      activeWorkspace: null
    });

    const guards = createSurfaceRouteGuards(stores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });

    await expect(guards.beforeLoadRoot()).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });
    expect(workspaceStore.hasActiveWorkspace).toBe(false);
    expect(workspaceStore.activeWorkspaceSlug).toBe("");
    expect(workspaceStore.activeWorkspace).toBeNull();
  });

  it("resolveRuntimeState handles transient and non-transient bootstrap failures", async () => {
    const transientStores = buildStores({
      authInitialized: false,
      workspaceInitialized: false,
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme"
    });
    const transientError = new Error("temporarily unavailable");
    transientError.status = 503;
    mocks.api.bootstrap.mockRejectedValueOnce(transientError);

    const transientState = await resolveRuntimeState(transientStores);
    expect(transientState.sessionUnavailable).toBe(true);
    expect(transientStores.authStore.setSignedOut).not.toHaveBeenCalled();
    expect(transientStores.workspaceStore.clearWorkspaceState).not.toHaveBeenCalled();

    const invalidStores = buildStores({
      authInitialized: false,
      workspaceInitialized: false,
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme"
    });
    const invalidError = new Error("session invalid");
    invalidError.status = 401;
    mocks.api.bootstrap.mockRejectedValueOnce(invalidError);

    const invalidState = await resolveRuntimeState(invalidStores);
    expect(invalidState.authenticated).toBe(false);
    expect(invalidStores.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(invalidStores.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
  });

  it("supports guard defaults and session-unavailable short circuit", async () => {
    const stores = buildStores({
      authInitialized: false,
      workspaceInitialized: false,
      canPermissions: []
    });
    const transientError = new Error("busy");
    transientError.status = 503;
    mocks.api.bootstrap.mockRejectedValue(transientError);

    const guards = createSurfaceRouteGuards(stores);

    await expect(guards.beforeLoadRoot()).resolves.toBeUndefined();
    await expect(guards.beforeLoadPublic()).resolves.toBeUndefined();
    await expect(guards.beforeLoadAuthenticated()).resolves.toBeUndefined();
    await expect(guards.beforeLoadAuthenticatedNoWorkspace()).resolves.toBeUndefined();
    await expect(guards.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "x" } })).resolves.toEqual({
      sessionUnavailable: true
    });
    await expect(
      guards.beforeLoadWorkspacePermissionsRequired({ params: { workspaceSlug: "x" } }, "workspace.settings.view")
    ).resolves.toBeUndefined();
  });

  it("runs beforeLoadAuthenticatedNoWorkspace and beforeLoadAuthenticated branches", async () => {
    const guards = createSurfaceRouteGuards(
      buildStores({
        authenticated: false
      }),
      {
        loginPath: "/custom/login",
        workspacesPath: "/custom/workspaces",
        workspaceHomePath: (slug) => `/custom/w/${slug}`
      }
    );

    await expect(guards.beforeLoadAuthenticatedNoWorkspace()).rejects.toMatchObject({
      options: { to: "/custom/login" }
    });
    await expect(guards.beforeLoadAuthenticated()).rejects.toMatchObject({
      options: { to: "/custom/login" }
    });

    const hasWorkspaceGuards = createSurfaceRouteGuards(
      buildStores({
        authenticated: true,
        hasWorkspace: true,
        workspaceSlug: "acme"
      }),
      {
        loginPath: "/custom/login",
        workspacesPath: "/custom/workspaces",
        workspaceHomePath: (slug) => `/custom/w/${slug}`
      }
    );

    await expect(hasWorkspaceGuards.beforeLoadAuthenticatedNoWorkspace()).rejects.toMatchObject({
      options: { to: "/custom/w/acme" }
    });
    await expect(hasWorkspaceGuards.beforeLoadAuthenticated()).resolves.toBeUndefined();
  });

  it("validates workspace-required guard and switching behavior", async () => {
    const unauthenticated = createSurfaceRouteGuards(
      buildStores({
        authenticated: false
      }),
      {
        loginPath: "/login",
        workspacesPath: "/workspaces",
        workspaceHomePath: (slug) => `/w/${slug}`
      }
    );
    await expect(
      unauthenticated.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "acme" } })
    ).rejects.toMatchObject({
      options: { to: "/login" }
    });

    const noWorkspace = createSurfaceRouteGuards(
      buildStores({
        authenticated: true,
        hasWorkspace: false
      }),
      {
        loginPath: "/login",
        workspacesPath: "/workspaces",
        workspaceHomePath: (slug) => `/w/${slug}`
      }
    );
    await expect(noWorkspace.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "acme" } })).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });

    const sameWorkspaceStores = buildStores({
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme"
    });
    const sameWorkspaceGuards = createSurfaceRouteGuards(sameWorkspaceStores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });
    await expect(
      sameWorkspaceGuards.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "acme" } })
    ).resolves.toBeUndefined();
    await expect(
      sameWorkspaceGuards.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "" } })
    ).resolves.toBeUndefined();
    expect(sameWorkspaceStores.workspaceStore.selectWorkspace).not.toHaveBeenCalled();

    const switchStores = buildStores({
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "old"
    });
    const switchGuards = createSurfaceRouteGuards(switchStores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });
    await expect(
      switchGuards.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "new" } })
    ).resolves.toBeUndefined();
    expect(switchStores.workspaceStore.selectWorkspace).toHaveBeenCalledWith("new");

    const failureStores = buildStores({
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "old"
    });
    failureStores.workspaceStore.selectWorkspace.mockRejectedValue(new Error("missing"));
    const failureGuards = createSurfaceRouteGuards(failureStores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });
    await expect(
      failureGuards.beforeLoadWorkspaceRequired({ params: { workspaceSlug: "missing" } })
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });
  });

  it("checks workspace permission requirements and redirects appropriately", async () => {
    const stores = buildStores({
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme",
      canPermissions: ["workspace.settings.view"]
    });
    const guards = createSurfaceRouteGuards(stores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });

    await expect(
      guards.beforeLoadWorkspacePermissionsRequired({ params: { workspaceSlug: "acme" } }, [
        "workspace.settings.update",
        "workspace.settings.view"
      ])
    ).resolves.toBeUndefined();
    await expect(
      guards.beforeLoadWorkspacePermissionsRequired({ params: { workspaceSlug: "acme" } }, [])
    ).resolves.toBeUndefined();

    stores.workspaceStore.can.mockReturnValue(false);
    await expect(
      guards.beforeLoadWorkspacePermissionsRequired({ params: { workspaceSlug: "acme" } }, "workspace.members.manage")
    ).rejects.toMatchObject({
      options: { to: "/w/acme" }
    });

    const noWorkspaceStores = buildStores({
      authenticated: true,
      hasWorkspace: false
    });
    const noWorkspaceGuards = createSurfaceRouteGuards(noWorkspaceStores, {
      loginPath: "/login",
      workspacesPath: "/workspaces",
      workspaceHomePath: (slug) => `/w/${slug}`
    });
    await expect(
      noWorkspaceGuards.beforeLoadWorkspacePermissionsRequired(
        { params: { workspaceSlug: "x" } },
        "workspace.members.manage"
      )
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });
  });
});
