import { redirect } from "@tanstack/vue-router";
import { api } from "./services/api/index.js";

async function resolveRuntimeState({ authStore, workspaceStore }) {
  let authenticated = authStore.isAuthenticated;
  let sessionUnavailable = false;

  try {
    if (!workspaceStore.initialized || !authStore.initialized) {
      const bootstrapPayload = await api.bootstrap();
      const session =
        bootstrapPayload?.session && typeof bootstrapPayload.session === "object" ? bootstrapPayload.session : {};
      authStore.applySession({
        authenticated: Boolean(session.authenticated),
        username: session.username || null
      });
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

  async function beforeLoadRoot() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
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

  async function beforeLoadAuthenticatedNoWorkspace() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }

    if (state.hasActiveWorkspace) {
      throw redirect({ to: workspaceHomePath(state.activeWorkspaceSlug) });
    }
  }

  async function beforeLoadAuthenticated() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
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
      throw redirect({ to: loginPath });
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

  return {
    beforeLoadRoot,
    beforeLoadPublic,
    beforeLoadAuthenticatedNoWorkspace,
    beforeLoadAuthenticated,
    beforeLoadWorkspaceRequired,
    beforeLoadWorkspacePermissionsRequired
  };
}

export { resolveRuntimeState, createSurfaceRouteGuards };
