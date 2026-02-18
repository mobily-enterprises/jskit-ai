import { describe, expect, it, vi } from "vitest";

import { createConsoleRouteGuards } from "../../src/routerGuards.console.js";

function buildStores({
  authInitialized = true,
  authenticated = false,
  hasConsoleAccess = false,
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

  const consoleStore = {
    initialized: true,
    hasAccess: hasConsoleAccess,
    hasPendingInvites,
    refreshBootstrap: vi.fn(async () => undefined),
    clearConsoleState: vi.fn(),
    setForbidden: vi.fn(),
    can: vi.fn(() => false)
  };

  return {
    authStore,
    workspaceStore,
    consoleStore
  };
}

describe("routerGuards.console", () => {
  it("redirects unauthenticated access to /console/login", async () => {
    const guards = createConsoleRouteGuards(buildStores({ authenticated: false }), {
      loginPath: "/console/login",
      rootPath: "/console"
    });

    await expect(guards.beforeLoadRoot()).rejects.toMatchObject({
      options: { to: "/console/login" }
    });
    await expect(guards.beforeLoadAuthenticated()).rejects.toMatchObject({
      options: { to: "/console/login" }
    });
  });

  it("redirects authenticated /console/login requests to /console", async () => {
    const guards = createConsoleRouteGuards(
      buildStores({
        authenticated: true,
        hasConsoleAccess: true
      }),
      {
        loginPath: "/console/login",
        rootPath: "/console"
      }
    );

    await expect(guards.beforeLoadPublic()).rejects.toMatchObject({
      options: { to: "/console" }
    });
  });

  it("does not require workspace for authenticated console routes", async () => {
    const stores = buildStores({
      authInitialized: false,
      authenticated: false,
      hasConsoleAccess: true
    });
    stores.authStore.ensureSession.mockImplementation(async () => {
      stores.authStore.initialized = true;
      stores.authStore.isAuthenticated = true;
    });

    const guards = createConsoleRouteGuards(stores, {
      loginPath: "/console/login",
      rootPath: "/console"
    });

    await expect(guards.beforeLoadRoot()).resolves.toBeUndefined();
    expect(stores.authStore.ensureSession).toHaveBeenCalledTimes(1);
    expect(stores.consoleStore.refreshBootstrap).not.toHaveBeenCalled();
    expect(stores.workspaceStore.clearWorkspaceState).not.toHaveBeenCalled();
  });

  it("routes authenticated users without console membership to invitations when pending", async () => {
    const guards = createConsoleRouteGuards(
      buildStores({
        authenticated: true,
        hasConsoleAccess: false,
        hasPendingInvites: true
      }),
      {
        loginPath: "/console/login",
        rootPath: "/console",
        invitationsPath: "/console/invitations",
        fallbackPath: "/"
      }
    );

    await expect(guards.beforeLoadRoot()).rejects.toMatchObject({
      options: { to: "/console/invitations" }
    });
  });
});
