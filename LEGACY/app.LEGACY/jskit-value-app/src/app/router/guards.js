import { redirect } from "@tanstack/vue-router";
import { normalizeReturnToPath } from "@jskit-ai/access-core/server/utils";
import { api } from "../../platform/http/api/index.js";
import { composeGuardPolicies } from "../../framework/composeGuards.js";

async function resolveRuntimeState({ authStore, workspaceStore }) {
  let authenticated = authStore.isAuthenticated;
  let sessionUnavailable = false;

  try {
    if (!workspaceStore.initialized || !authStore.initialized) {
      const bootstrapPayload = await api.workspace.bootstrap();
      const session =
        bootstrapPayload?.session && typeof bootstrapPayload.session === "object" ? bootstrapPayload.session : {};
      authStore.applySession(session);
      workspaceStore.applyBootstrap(bootstrapPayload);
      authenticated = Boolean(session.authenticated);
    } else {
      authenticated = Boolean(authStore.isAuthenticated);
    }
  } catch (error) {
    if (error?.status === 503) {
      sessionUnavailable = true;
    } else {
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      authenticated = false;
    }
  }

  return {
    authenticated,
    hasActiveWorkspace: workspaceStore.hasActiveWorkspace,
    activeWorkspaceSlug: workspaceStore.activeWorkspaceSlug,
    sessionUnavailable
  };
}

function createSurfaceRouteGuards(stores, options) {
  const loginPath = String(options?.loginPath || "/login");
  const workspacesPath = String(options?.workspacesPath || "/workspaces");
  const workspaceHomePath =
    typeof options?.workspaceHomePath === "function"
      ? options.workspaceHomePath
      : (workspaceSlug) => `/w/${workspaceSlug}`;
  const guardPolicies =
    options?.guardPolicies && typeof options.guardPolicies === "object" ? options.guardPolicies : composeGuardPolicies();

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
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (!state.hasActiveWorkspace) {
      throw redirect({ to: workspacesPath });
    }

    throw redirect({ to: workspaceHomePath(state.activeWorkspaceSlug) });
  }

  async function beforeLoadPublic() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      return;
    }

    if (state.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(state.activeWorkspaceSlug) });
    }

    throw redirect({ to: workspacesPath });
  }

  async function beforeLoadAuthenticatedNoWorkspace(context) {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (state.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(state.activeWorkspaceSlug) });
    }
  }

  async function beforeLoadAuthenticated(context) {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }
  }

  async function beforeLoadWorkspaceRequired(context) {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return {
        sessionUnavailable: true
      };
    }

    if (!state.authenticated) {
      throw redirect(loginRedirectOptions(context));
    }

    if (!state.hasActiveWorkspace) {
      throw redirect({ to: workspacesPath });
    }

    const routeWorkspaceSlug = String(context?.params?.workspaceSlug || "").trim();
    if (routeWorkspaceSlug && routeWorkspaceSlug !== state.activeWorkspaceSlug) {
      try {
        await stores.workspaceStore.selectWorkspace(routeWorkspaceSlug);
        return;
      } catch {
        throw redirect({ to: workspacesPath });
      }
    }
  }

  function hasAnyWorkspacePermission(requiredPermissions) {
    const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    const normalized = permissions.map((permission) => String(permission || "").trim()).filter(Boolean);

    if (normalized.length < 1) {
      return true;
    }

    return normalized.some((permission) => stores.workspaceStore.can(permission));
  }

  async function beforeLoadWorkspacePermissionsRequired(context, requiredPermissions) {
    const workspaceGuardResult = await beforeLoadWorkspaceRequired(context);
    if (workspaceGuardResult?.sessionUnavailable) {
      return;
    }

    if (hasAnyWorkspacePermission(requiredPermissions)) {
      return;
    }

    if (stores.workspaceStore.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(stores.workspaceStore.activeWorkspaceSlug) });
    }

    throw redirect({ to: workspacesPath });
  }

  function resolveAssistantAccessPolicy() {
    const policy =
      guardPolicies.assistant && typeof guardPolicies.assistant === "object" ? guardPolicies.assistant : {};
    const appFeatures =
      stores.workspaceStore?.app && typeof stores.workspaceStore.app === "object"
        ? stores.workspaceStore.app.features || {}
        : {};
    const featureFlag = String(policy.featureFlag || "assistantEnabled").trim() || "assistantEnabled";
    const permissionField =
      String(policy.requiredFeaturePermissionKey || "assistantRequiredPermission").trim() ||
      "assistantRequiredPermission";

    return {
      assistantEnabled: Boolean(appFeatures[featureFlag]),
      assistantRequiredPermission: String(appFeatures[permissionField] || "").trim()
    };
  }

  function resolveSocialAccessPolicy() {
    const policy = guardPolicies.social && typeof guardPolicies.social === "object" ? guardPolicies.social : {};
    const appFeatures =
      stores.workspaceStore?.app && typeof stores.workspaceStore.app === "object"
        ? stores.workspaceStore.app.features || {}
        : {};
    const featureFlag = String(policy.featureFlag || "socialEnabled").trim() || "socialEnabled";

    return {
      socialEnabled: Boolean(appFeatures[featureFlag])
    };
  }

  async function beforeLoadAssistant(context) {
    const workspaceGuardResult = await beforeLoadWorkspaceRequired(context);
    if (workspaceGuardResult?.sessionUnavailable) {
      return;
    }

    const { assistantEnabled, assistantRequiredPermission } = resolveAssistantAccessPolicy();
    const hasAssistantPermission =
      !assistantRequiredPermission || stores.workspaceStore.can(assistantRequiredPermission);

    if (assistantEnabled && hasAssistantPermission) {
      return;
    }

    if (stores.workspaceStore.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(stores.workspaceStore.activeWorkspaceSlug) });
    }

    throw redirect({ to: workspacesPath });
  }

  async function beforeLoadSocial(context) {
    const workspaceGuardResult = await beforeLoadWorkspacePermissionsRequired(context, ["social.read"]);
    if (workspaceGuardResult?.sessionUnavailable) {
      return;
    }

    const { socialEnabled } = resolveSocialAccessPolicy();
    if (socialEnabled) {
      return;
    }

    if (stores.workspaceStore.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(stores.workspaceStore.activeWorkspaceSlug) });
    }

    throw redirect({ to: workspacesPath });
  }

  return {
    beforeLoadRoot,
    beforeLoadPublic,
    beforeLoadAuthenticatedNoWorkspace,
    beforeLoadAuthenticated,
    beforeLoadWorkspaceRequired,
    beforeLoadWorkspacePermissionsRequired,
    beforeLoadAssistant,
    beforeLoadSocial
  };
}

export { resolveRuntimeState, createSurfaceRouteGuards };
