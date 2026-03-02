import { redirect } from "@tanstack/vue-router";
import { normalizeReturnToPath } from "@jskit-ai/access-core/server/utils";

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

  function ensureAuthenticated(state, context) {
    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }
  }

  function ensureConsoleAccess(state) {
    if (state.hasConsoleAccess) {
      return;
    }

    if (state.hasPendingInvites) {
      throw redirect({ to: invitationsPath });
    }

    throw redirect({ to: fallbackPath });
  }

  function ensureConsolePermission(permission) {
    if (!resolvedStores.consoleStore.can(permission)) {
      throw redirect({ to: rootPath });
    }
  }

  async function beforeLoadConsoleProtected(context, permission) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    ensureAuthenticated(state, context);
    ensureConsoleAccess(state);
    ensureConsolePermission(permission);
  }

  async function beforeLoadRoot(context) {
    const state = await resolveConsoleRuntimeState(resolvedStores);
    if (state.sessionUnavailable) {
      return;
    }

    ensureAuthenticated(state, context);
    ensureConsoleAccess(state);
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

    ensureAuthenticated(state, context);

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

    ensureAuthenticated(state, context);
  }

  async function beforeLoadMembers(context) {
    return beforeLoadConsoleProtected(context, "console.members.view");
  }

  async function beforeLoadBrowserErrors(context) {
    return beforeLoadConsoleProtected(context, "console.errors.browser.read");
  }

  async function beforeLoadBrowserErrorDetails(context) {
    return beforeLoadBrowserErrors(context);
  }

  async function beforeLoadServerErrors(context) {
    return beforeLoadConsoleProtected(context, "console.errors.server.read");
  }

  async function beforeLoadServerErrorDetails(context) {
    return beforeLoadServerErrors(context);
  }

  async function beforeLoadAiTranscripts(context) {
    return beforeLoadConsoleProtected(context, "console.ai.transcripts.read_all");
  }

  async function beforeLoadBillingEvents(context) {
    return beforeLoadConsoleProtected(context, "console.billing.events.read_all");
  }

  async function beforeLoadBillingPlans(context) {
    return beforeLoadConsoleProtected(context, "console.billing.catalog.manage");
  }

  async function beforeLoadBillingEntitlements(context) {
    return beforeLoadBillingPlans(context);
  }

  async function beforeLoadBillingPurchases(context) {
    return beforeLoadConsoleProtected(context, "console.billing.operations.manage");
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
