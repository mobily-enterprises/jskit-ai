import { redirect } from "@tanstack/vue-router";
import { normalizeReturnToPath } from "@jskit-ai/access-core/utils";

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

  function splitPathname(pathValue) {
    const [withoutHash] = String(pathValue || "").split("#");
    const [pathnameOnly] = withoutHash.split("?");
    return pathnameOnly || "";
  }

  function resolveReturnToPath(context) {
    const locationPathname = String(context?.location?.pathname || "");
    const locationSearch = String(context?.location?.search || "");
    const fallbackPathname = typeof window !== "undefined" ? String(window.location?.pathname || "") : "";
    const fallbackSearch = typeof window !== "undefined" ? String(window.location?.search || "") : "";
    const candidatePath = `${locationPathname || fallbackPathname}${locationSearch || fallbackSearch}`;

    return normalizeReturnToPath(candidatePath, { fallback: "" });
  }

  function loginRedirectOptions(context) {
    const returnTo = resolveReturnToPath(context);
    if (!returnTo || splitPathname(returnTo) === loginPath) {
      return { to: loginPath };
    }

    return {
      to: loginPath,
      search: {
        returnTo
      }
    };
  }

  async function beforeLoadRoot(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadInvitations(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (state.hasConsoleAccess) {
      throw redirect({ to: rootPath });
    }

    if (state.hasPendingInvites) {
      return;
    }

    throw redirect({ to: fallbackPath });
  }

  async function beforeLoadAuthenticated(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }
  }

  async function beforeLoadMembers(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadBrowserErrors(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadBrowserErrorDetails(context) {
    return beforeLoadBrowserErrors(context);
  }

  async function beforeLoadServerErrors(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadServerErrorDetails(context) {
    return beforeLoadServerErrors(context);
  }

  async function beforeLoadAiTranscripts(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadBillingEvents(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
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

  async function beforeLoadBillingPlans(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.billing.catalog.manage")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadBillingEntitlements(context) {
    return beforeLoadBillingPlans(context);
  }

  async function beforeLoadBillingPurchases(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (!state.hasConsoleAccess) {
      if (state.hasPendingInvites) {
        throw redirect({ to: invitationsPath });
      }

      throw redirect({ to: fallbackPath });
    }

    if (!resolvedStores.consoleStore.can("console.billing.operations.manage")) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadBillingPlanAssignments(context) {
    return beforeLoadBillingPurchases(context);
  }

  async function beforeLoadBillingSubscriptions(context) {
    return beforeLoadBillingPurchases(context);
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
    beforeLoadBillingEvents,
    beforeLoadBillingPlans,
    beforeLoadBillingEntitlements,
    beforeLoadBillingPurchases,
    beforeLoadBillingPlanAssignments,
    beforeLoadBillingSubscriptions
  };
}

export { resolveConsoleRuntimeState, createConsoleRouteGuards };
