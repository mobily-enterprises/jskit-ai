import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect
} from "@tanstack/vue-router";
import { api } from "./services/api";
import App from "./App.vue";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("./views/LoginView.vue"));
const AnnuityCalculatorView = lazyRouteComponent(() => import("./views/AnnuityCalculatorView.vue"));
const ChoiceTwoView = lazyRouteComponent(() => import("./views/ChoiceTwoView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("./views/ResetPasswordView.vue"));
const SettingsView = lazyRouteComponent(() => import("./views/SettingsView.vue"));
const WorkspacesView = lazyRouteComponent(() => import("./views/WorkspacesView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

async function resolveRuntimeState({ authStore, workspaceStore }) {
  let authenticated = authStore.isAuthenticated;
  let sessionUnavailable = false;

  try {
    if (!workspaceStore.initialized || !authStore.initialized) {
      const bootstrapPayload = await api.bootstrap();
      const session = bootstrapPayload?.session && typeof bootstrapPayload.session === "object" ? bootstrapPayload.session : {};
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

async function beforeLoadRoot(stores) {
  const state = await resolveRuntimeState(stores);
  if (state.sessionUnavailable) {
    return;
  }

  if (!state.authenticated) {
    throw redirect({ to: "/login" });
  }

  if (!state.hasActiveWorkspace) {
    throw redirect({ to: "/workspaces" });
  }

  throw redirect({ to: `/w/${state.activeWorkspaceSlug}` });
}

async function beforeLoadPublic(stores) {
  const state = await resolveRuntimeState(stores);
  if (state.sessionUnavailable) {
    return;
  }

  if (!state.authenticated) {
    return;
  }

  if (state.hasActiveWorkspace) {
    throw redirect({ to: `/w/${state.activeWorkspaceSlug}` });
  }

  throw redirect({ to: "/workspaces" });
}

async function beforeLoadAuthenticatedNoWorkspace(stores) {
  const state = await resolveRuntimeState(stores);
  if (state.sessionUnavailable) {
    return;
  }

  if (!state.authenticated) {
    throw redirect({ to: "/login" });
  }

  if (state.hasActiveWorkspace) {
    throw redirect({ to: `/w/${state.activeWorkspaceSlug}` });
  }
}

async function beforeLoadWorkspaceRequired(stores, context) {
  const state = await resolveRuntimeState(stores);
  if (state.sessionUnavailable) {
    return;
  }

  if (!state.authenticated) {
    throw redirect({ to: "/login" });
  }

  if (!state.hasActiveWorkspace) {
    throw redirect({ to: "/workspaces" });
  }

  const routeWorkspaceSlug = String(context?.params?.workspaceSlug || "").trim();
  if (routeWorkspaceSlug && routeWorkspaceSlug !== state.activeWorkspaceSlug) {
    try {
      await stores.workspaceStore.selectWorkspace(routeWorkspaceSlug);
      return;
    } catch {
      throw redirect({ to: "/workspaces" });
    }
  }
}

export function createAppRouter({ authStore, workspaceStore }) {
  const stores = { authStore, workspaceStore };

  const rootRoute = createRootRoute({
    component: App
  });

  const rootRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: AnnuityCalculatorView,
    beforeLoad: beforeLoadRoot.bind(null, stores)
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginView,
    beforeLoad: beforeLoadPublic.bind(null, stores)
  });

  const resetPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reset-password",
    component: ResetPasswordView
  });

  const workspacesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/workspaces",
    component: WorkspacesView,
    beforeLoad: beforeLoadAuthenticatedNoWorkspace.bind(null, stores)
  });

  const calculatorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$workspaceSlug",
    component: AnnuityCalculatorView,
    beforeLoad: beforeLoadWorkspaceRequired.bind(null, stores)
  });

  const choiceTwoRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$workspaceSlug/choice-2",
    component: ChoiceTwoView,
    beforeLoad: beforeLoadWorkspaceRequired.bind(null, stores)
  });

  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$workspaceSlug/settings",
    component: SettingsView,
    beforeLoad: beforeLoadWorkspaceRequired.bind(null, stores)
  });

  const routeTree = rootRoute.addChildren([
    rootRedirectRoute,
    calculatorRoute,
    choiceTwoRoute,
    settingsRoute,
    workspacesRoute,
    loginRoute,
    resetPasswordRoute
  ]);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export const __testables = {
  resolveRuntimeState,
  beforeLoadRoot,
  beforeLoadPublic,
  beforeLoadAuthenticatedNoWorkspace,
  beforeLoadWorkspaceRequired
};
