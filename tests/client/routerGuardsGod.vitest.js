import { describe, expect, it, vi } from "vitest";

import { createGodRouteGuards } from "../../src/routerGuards.god.js";

function buildStores({
  authInitialized = true,
  authenticated = false,
  hasGodAccess = false,
  hasPendingInvites = false
} = {}) {
  const authStore = {
    initialized: authInitialized,
    isAuthenticated: authenticated,
    ensureSession: vi.fn(async () => undefined),
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
    clearWorkspaceState: vi.fn(() => {
      workspaceStore.cleared = true;
    })
  };

  const godStore = {
    initialized: true,
    hasAccess: hasGodAccess,
    hasPendingInvites,
    refreshBootstrap: vi.fn(async () => undefined),
    clearGodState: vi.fn(),
    setForbidden: vi.fn(),
    can: vi.fn(() => false)
  };

  return {
    authStore,
    workspaceStore,
    godStore
  };
}

describe("routerGuards.god", () => {
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
        hasGodAccess: true
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
      authenticated: false,
      hasGodAccess: true
    });
    stores.authStore.ensureSession.mockImplementation(async () => {
      stores.authStore.initialized = true;
      stores.authStore.isAuthenticated = true;
    });

    const guards = createGodRouteGuards(stores, {
      loginPath: "/god/login",
      rootPath: "/god"
    });

    await expect(guards.beforeLoadRoot()).resolves.toBeUndefined();
    expect(stores.authStore.ensureSession).toHaveBeenCalledTimes(1);
    expect(stores.godStore.refreshBootstrap).not.toHaveBeenCalled();
    expect(stores.workspaceStore.clearWorkspaceState).not.toHaveBeenCalled();
  });

  it("routes authenticated users without god membership to invitations when pending", async () => {
    const guards = createGodRouteGuards(
      buildStores({
        authenticated: true,
        hasGodAccess: false,
        hasPendingInvites: true
      }),
      {
        loginPath: "/god/login",
        rootPath: "/god",
        invitationsPath: "/god/invitations",
        fallbackPath: "/"
      }
    );

    await expect(guards.beforeLoadRoot()).rejects.toMatchObject({
      options: { to: "/god/invitations" }
    });
  });
});
