import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    workspace: {
      bootstrap: vi.fn()
    }
  }
}));

vi.mock("../../src/shells/admin/AdminShell.vue", () => ({
  default: {
    name: "AppShellMock"
  }
}));

vi.mock("../../src/shells/app/AppShell.vue", () => ({
  default: {
    name: "CustomerShellMock"
  }
}));

vi.mock("../../src/shells/console/ConsoleShell.vue", () => ({
  default: {
    name: "ConsoleShellMock"
  }
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { createAppRouter, createRouterForCurrentPath, createRouterForSurface, __testables } from "../../src/router.js";

function buildStores({
  authInitialized = false,
  workspaceInitialized = false,
  authenticated = false,
  hasWorkspace = false,
  workspaceSlug = null
} = {}) {
  const authStore = {
    initialized: authInitialized,
    isAuthenticated: authenticated,
    username: null,
    applySession: vi.fn(({ authenticated: nextAuthenticated, username }) => {
      authStore.initialized = true;
      authStore.isAuthenticated = Boolean(nextAuthenticated);
      authStore.username = username || null;
    }),
    setSignedOut: vi.fn(() => {
      authStore.initialized = true;
      authStore.isAuthenticated = false;
      authStore.username = null;
    })
  };

  const workspaceStore = {
    initialized: workspaceInitialized,
    hasActiveWorkspace: hasWorkspace,
    activeWorkspaceSlug: workspaceSlug,
    applyBootstrap: vi.fn((payload) => {
      workspaceStore.initialized = true;
      const workspace = payload?.workspace && typeof payload.workspace === "object" ? payload.workspace : null;
      workspaceStore.hasActiveWorkspace = Boolean(workspace?.slug);
      workspaceStore.activeWorkspaceSlug = workspace?.slug || null;
    }),
    clearWorkspaceState: vi.fn(() => {
      workspaceStore.initialized = true;
      workspaceStore.hasActiveWorkspace = false;
      workspaceStore.activeWorkspaceSlug = null;
    }),
    selectWorkspace: vi.fn(async (slug) => {
      workspaceStore.hasActiveWorkspace = true;
      workspaceStore.activeWorkspaceSlug = slug;
    })
  };

  return {
    authStore,
    workspaceStore
  };
}

describe("router auth guards", () => {
  it("resolveRuntimeState bootstraps and returns authenticated workspace state", async () => {
    const stores = buildStores();
    mocks.api.workspace.bootstrap.mockResolvedValue({
      session: {
        authenticated: true,
        username: "alice"
      },
      workspace: {
        slug: "acme"
      }
    });

    const state = await __testables.resolveRuntimeState(stores);
    expect(state).toEqual({
      authenticated: true,
      hasActiveWorkspace: true,
      activeWorkspaceSlug: "acme",
      sessionUnavailable: false
    });
    expect(stores.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: "alice"
    });
    expect(stores.workspaceStore.applyBootstrap).toHaveBeenCalledTimes(1);
  });

  it("resolveRuntimeState marks session unavailable on transient bootstrap errors", async () => {
    const stores = buildStores({
      authenticated: true
    });
    const error = new Error("temporarily unavailable");
    error.status = 503;
    mocks.api.workspace.bootstrap.mockRejectedValue(error);

    const state = await __testables.resolveRuntimeState(stores);
    expect(state.sessionUnavailable).toBe(true);
    expect(state.authenticated).toBe(true);
    expect(stores.authStore.setSignedOut).not.toHaveBeenCalled();
    expect(stores.workspaceStore.clearWorkspaceState).not.toHaveBeenCalled();
  });

  it("resolveRuntimeState signs out and clears workspace on non-transient errors", async () => {
    const stores = buildStores({
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "acme"
    });
    const error = new Error("invalid session");
    error.status = 401;
    mocks.api.workspace.bootstrap.mockRejectedValue(error);

    const state = await __testables.resolveRuntimeState(stores);
    expect(state).toEqual({
      authenticated: false,
      hasActiveWorkspace: false,
      activeWorkspaceSlug: null,
      sessionUnavailable: false
    });
    expect(stores.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(stores.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
  });

  it("beforeLoadRoot redirects according to auth/workspace state", async () => {
    mocks.api.workspace.bootstrap.mockReset();

    await expect(
      __testables.beforeLoadRoot(buildStores({ authInitialized: true, workspaceInitialized: true }))
    ).rejects.toMatchObject({
      options: { to: "/login" }
    });

    await expect(
      __testables.beforeLoadRoot(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true,
          authenticated: true
        })
      )
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });

    await expect(
      __testables.beforeLoadRoot(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true,
          authenticated: true,
          hasWorkspace: true,
          workspaceSlug: "acme"
        })
      )
    ).rejects.toMatchObject({
      options: { to: "/w/acme" }
    });
  });

  it("beforeLoadPublic allows unauthenticated and redirects authenticated sessions", async () => {
    mocks.api.workspace.bootstrap.mockReset();

    await expect(
      __testables.beforeLoadPublic(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true
        })
      )
    ).resolves.toBeUndefined();

    await expect(
      __testables.beforeLoadPublic(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true,
          authenticated: true
        })
      )
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });

    await expect(
      __testables.beforeLoadPublic(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true,
          authenticated: true,
          hasWorkspace: true,
          workspaceSlug: "acme"
        })
      )
    ).rejects.toMatchObject({
      options: { to: "/w/acme" }
    });
  });

  it("beforeLoadWorkspaceRequired validates auth/workspace and switches workspaces by slug", async () => {
    mocks.api.workspace.bootstrap.mockReset();

    await expect(
      __testables.beforeLoadWorkspaceRequired(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true
        }),
        { params: { workspaceSlug: "acme" } }
      )
    ).rejects.toMatchObject({
      options: { to: "/login" }
    });

    await expect(
      __testables.beforeLoadWorkspaceRequired(
        buildStores({
          authInitialized: true,
          workspaceInitialized: true,
          authenticated: true
        }),
        { params: { workspaceSlug: "acme" } }
      )
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });

    const switchingStores = buildStores({
      authInitialized: true,
      workspaceInitialized: true,
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "old"
    });
    await expect(
      __testables.beforeLoadWorkspaceRequired(switchingStores, { params: { workspaceSlug: "new-workspace" } })
    ).resolves.toBeUndefined();
    expect(switchingStores.workspaceStore.selectWorkspace).toHaveBeenCalledWith("new-workspace");
  });

  it("beforeLoadWorkspaceRequired redirects to workspace list if workspace switching fails", async () => {
    const stores = buildStores({
      authInitialized: true,
      workspaceInitialized: true,
      authenticated: true,
      hasWorkspace: true,
      workspaceSlug: "old"
    });
    stores.workspaceStore.selectWorkspace.mockRejectedValue(new Error("missing workspace"));

    await expect(
      __testables.beforeLoadWorkspaceRequired(stores, { params: { workspaceSlug: "missing" } })
    ).rejects.toMatchObject({
      options: { to: "/workspaces" }
    });
  });

  it("creates router instance with configured routes", () => {
    const stores = buildStores({
      authInitialized: true,
      workspaceInitialized: true
    });

    const router = createAppRouter(stores);
    expect(router).toBeTruthy();
    expect(typeof router.navigate).toBe("function");
  });

  it("falls back to app router for unknown surfaces", () => {
    const stores = buildStores({
      authInitialized: true,
      workspaceInitialized: true
    });

    const router = createRouterForSurface({
      ...stores,
      surface: "unsupported-surface"
    });

    expect(router).toBeTruthy();
    expect(typeof router.navigate).toBe("function");
  });

  it("resolves current path from explicit pathname and window fallback", () => {
    const stores = buildStores({
      authInitialized: true,
      workspaceInitialized: true
    });

    const explicitRouter = createRouterForCurrentPath({
      ...stores,
      pathname: "/admin/login"
    });
    expect(explicitRouter).toBeTruthy();

    const consoleRouter = createRouterForCurrentPath({
      ...stores,
      pathname: "/console/login"
    });
    expect(consoleRouter).toBeTruthy();

    window.history.replaceState({}, "", "/admin/w/acme");
    const implicitRouter = createRouterForCurrentPath(stores);
    expect(implicitRouter).toBeTruthy();
  });
});
