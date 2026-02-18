import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    workspace: {
      bootstrap: vi.fn()
    }
  }
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { createGodRouteGuards } from "../../src/routerGuards.god.js";

function buildStores({
  authInitialized = true,
  workspaceInitialized = true,
  authenticated = false,
  hasWorkspace = false,
  workspaceSlug = ""
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
    })
  };

  return {
    authStore,
    workspaceStore
  };
}

describe("routerGuards.god", () => {
  beforeEach(() => {
    mocks.api.workspace.bootstrap.mockReset();
  });

  it("redirects unauthenticated access to /god/login", async () => {
    const guards = createGodRouteGuards(buildStores({ authenticated: false }), {
      loginPath: "/god/login",
      rootPath: "/god"
    });

    await expect(guards.beforeLoadRoot()).rejects.toMatchObject({
      options: { to: "/god/login" }
    });
    await expect(guards.beforeLoadAuthenticated()).rejects.toMatchObject({
      options: { to: "/god/login" }
    });
  });

  it("redirects authenticated /god/login requests to /god", async () => {
    const guards = createGodRouteGuards(
      buildStores({
        authenticated: true,
        hasWorkspace: false
      }),
      {
        loginPath: "/god/login",
        rootPath: "/god"
      }
    );

    await expect(guards.beforeLoadPublic()).rejects.toMatchObject({
      options: { to: "/god" }
    });
  });

  it("does not require workspace for authenticated god routes", async () => {
    const stores = buildStores({
      authInitialized: false,
      workspaceInitialized: false
    });
    mocks.api.workspace.bootstrap.mockResolvedValue({
      session: {
        authenticated: true
      },
      workspace: null
    });

    const guards = createGodRouteGuards(stores, {
      loginPath: "/god/login",
      rootPath: "/god"
    });

    await expect(guards.beforeLoadRoot()).resolves.toBeUndefined();
    expect(mocks.api.workspace.bootstrap).toHaveBeenCalledTimes(1);
    expect(stores.authStore.applySession).toHaveBeenCalledWith({
      authenticated: true,
      username: null
    });
    expect(stores.workspaceStore.applyBootstrap).toHaveBeenCalledTimes(1);
  });
});
