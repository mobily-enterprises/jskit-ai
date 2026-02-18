import { redirect } from "@tanstack/vue-router";

function resolveGodStore(godStore) {
  if (godStore && typeof godStore === "object") {
    return godStore;
  }

  return {
    initialized: false,
    hasAccess: false,
    hasPendingInvites: false,
    async refreshBootstrap() {},
    clearGodState() {},
    setForbidden() {},
    can() {
      return false;
    }
  };
}

async function resolveGodRuntimeState({ authStore, workspaceStore, godStore }) {
  const resolvedGodStore = resolveGodStore(godStore);
  let authenticated = Boolean(authStore.isAuthenticated);
  let sessionUnavailable = false;

  try {
    if (!authStore.initialized) {
      await authStore.ensureSession();
    }
    authenticated = Boolean(authStore.isAuthenticated);
  } catch (error) {
    if (Number(error?.status) === 503) {
      sessionUnavailable = true;
    } else {
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      resolvedGodStore.clearGodState();
      authenticated = false;
    }
  }

  if (!authenticated || sessionUnavailable) {
    if (!authenticated) {
      resolvedGodStore.clearGodState();
    }

    return {
      authenticated,
      hasGodAccess: false,
      hasPendingInvites: false,
      sessionUnavailable
    };
  }

  try {
    if (!resolvedGodStore.initialized) {
      await resolvedGodStore.refreshBootstrap();
    }
  } catch (error) {
    if (Number(error?.status) === 503) {
      sessionUnavailable = true;
    } else if (Number(error?.status) === 403) {
      resolvedGodStore.setForbidden();
    } else if (Number(error?.status) === 401) {
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      resolvedGodStore.clearGodState();
      authenticated = false;
    } else {
      throw error;
    }
  }

  return {
    authenticated,
    hasGodAccess: Boolean(resolvedGodStore.hasAccess),
    hasPendingInvites: Boolean(resolvedGodStore.hasPendingInvites),
    sessionUnavailable
  };
}

function createGodRouteGuards(stores, options) {
  const resolvedStores = {
    ...stores,
    godStore: resolveGodStore(stores?.godStore)
  };
  const loginPath = String(options?.loginPath || "/login");
  const rootPath = String(options?.rootPath || "/");
  const invitationsPath = String(options?.invitationsPath || "/invitations");
  const fallbackPath = String(options?.fallbackPath || "/");

  async function beforeLoadRoot() {
    const state = await resolveGodRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (state.hasGodAccess) {
      return;
    }

    if (state.hasPendingInvites) {
      throw redirect({ to: invitationsPath });
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadPublic() {
    const state = await resolveGodRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      return;
    }

    if (state.hasGodAccess) {
      throw redirect({ to: rootPath });
    }

    if (state.hasPendingInvites) {
      throw redirect({ to: invitationsPath });
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadInvitations() {
    const state = await resolveGodRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (state.hasGodAccess) {
      throw redirect({ to: rootPath });
    }

    if (state.hasPendingInvites) {
      return;
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadAuthenticated() {
    const state = await resolveGodRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }
  }

  async function beforeLoadMembers() {
    const state = await resolveGodRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasGodAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.godStore.can("god.members.view")) {
      throw redirect({ to: rootPath });
    }
  }

  return {
    beforeLoadRoot,
    beforeLoadPublic,
    beforeLoadInvitations,
    beforeLoadAuthenticated,
    beforeLoadMembers
  };
}

export { resolveGodRuntimeState, createGodRouteGuards };
