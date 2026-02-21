import { redirect } from "@tanstack/vue-router";

function resolveConsoleStore(consoleStore) {
  if (consoleStore && typeof consoleStore === "object") {
    return consoleStore;
  }

  return {
    initialized: false,
    hasAccess: false,
    hasPendingInvites: false,
    async refreshBootstrap() {},
    clearConsoleState() {},
    setForbidden() {},
    can() {
      return false;
    }
  };
}

async function resolveConsoleRuntimeState({ authStore, workspaceStore, consoleStore }) {
  const resolvedConsoleStore = resolveConsoleStore(consoleStore);
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
      resolvedConsoleStore.clearConsoleState();
      authenticated = false;
    }
  }

  if (!authenticated || sessionUnavailable) {
    if (!authenticated) {
      resolvedConsoleStore.clearConsoleState();
    }

    return {
      authenticated,
      hasConsoleAccess: false,
      hasPendingInvites: false,
      sessionUnavailable
    };
  }

  try {
    if (!resolvedConsoleStore.initialized) {
      await resolvedConsoleStore.refreshBootstrap();
    }
  } catch (error) {
    if (Number(error?.status) === 503) {
      sessionUnavailable = true;
    } else if (Number(error?.status) === 403) {
      resolvedConsoleStore.setForbidden();
    } else if (Number(error?.status) === 401) {
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      resolvedConsoleStore.clearConsoleState();
      authenticated = false;
    } else {
      throw error;
    }
  }

  return {
    authenticated,
    hasConsoleAccess: Boolean(resolvedConsoleStore.hasAccess),
    hasPendingInvites: Boolean(resolvedConsoleStore.hasPendingInvites),
    sessionUnavailable
  };
}

function createConsoleRouteGuards(stores, options) {
  const resolvedStores = {
    ...stores,
    consoleStore: resolveConsoleStore(stores?.consoleStore)
  };
  const loginPath = String(options?.loginPath || "/login");
  const rootPath = String(options?.rootPath || "/");
  const invitationsPath = String(options?.invitationsPath || "/invitations");
  const fallbackPath = String(options?.fallbackPath || "/");

  async function beforeLoadRoot() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (state.hasConsoleAccess) {
      return;
    }

    if (state.hasPendingInvites) {
      throw redirect({ to: invitationsPath });
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadPublic() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      return;
    }

    if (state.hasConsoleAccess) {
      throw redirect({ to: rootPath });
    }

    if (state.hasPendingInvites) {
      throw redirect({ to: invitationsPath });
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadInvitations() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (state.hasConsoleAccess) {
      throw redirect({ to: rootPath });
    }

    if (state.hasPendingInvites) {
      return;
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadAuthenticated() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }
  }

  async function beforeLoadMembers() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.members.view")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadBrowserErrors() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.errors.browser.read")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadBrowserErrorDetails() {
    return beforeLoadBrowserErrors();
  }

  async function beforeLoadServerErrors() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.errors.server.read")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadServerErrorDetails() {
    return beforeLoadServerErrors();
  }

  async function beforeLoadAiTranscripts() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.ai.transcripts.read_all")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadBillingEvents() {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.billing.events.read_all")) {
      throw redirect({ to: rootPath });
    }
  }

  return {
    beforeLoadRoot,
    beforeLoadPublic,
    beforeLoadInvitations,
    beforeLoadAuthenticated,
    beforeLoadMembers,
    beforeLoadBrowserErrors,
    beforeLoadBrowserErrorDetails,
    beforeLoadServerErrors,
    beforeLoadServerErrorDetails,
    beforeLoadAiTranscripts,
    beforeLoadBillingEvents
  };
}

export { resolveConsoleRuntimeState, createConsoleRouteGuards };
