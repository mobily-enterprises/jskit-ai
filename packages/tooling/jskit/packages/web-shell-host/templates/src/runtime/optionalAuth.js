const AUTH_GUARD_RUNTIME_MODULES = import.meta.glob("./authGuardRuntime.js");
const LOGIN_VIEW_MODULES = import.meta.glob("../views/login/LoginView.vue");
const SIGN_OUT_VIEW_MODULES = import.meta.glob("../views/auth/SignOutView.vue");

function resolveFirstLoader(modules, label) {
  const entries = Object.entries(modules || {});
  if (entries.length < 1) {
    return null;
  }
  if (entries.length > 1) {
    throw new Error(`Multiple optional auth modules matched ${label}.`);
  }
  const [, loader] = entries[0];
  if (typeof loader !== "function") {
    throw new TypeError(`Optional auth module loader for ${label} is invalid.`);
  }
  return loader;
}

async function loadOptionalModule(modules, label) {
  const loader = resolveFirstLoader(modules, label);
  if (!loader) {
    return null;
  }
  const loaded = await loader();
  if (!loaded || typeof loaded !== "object") {
    throw new TypeError(`Optional auth module for ${label} did not return a module object.`);
  }
  return loaded;
}

async function initializeOptionalAuthGuardRuntime({ loginRoute = "/login" } = {}) {
  const authGuardModule = await loadOptionalModule(AUTH_GUARD_RUNTIME_MODULES, "runtime/authGuardRuntime.js");
  if (!authGuardModule) {
    return false;
  }

  if (typeof authGuardModule.initializeAuthGuardRuntime !== "function") {
    throw new TypeError("runtime/authGuardRuntime.js must export initializeAuthGuardRuntime().");
  }

  await authGuardModule.initializeAuthGuardRuntime({
    loginRoute
  });

  return true;
}

async function listOptionalPublicAuthRoutes() {
  const routes = [];

  const loginViewModule = await loadOptionalModule(LOGIN_VIEW_MODULES, "views/login/LoginView.vue");
  if (loginViewModule) {
    if (!loginViewModule.default) {
      throw new TypeError("views/login/LoginView.vue must export a Vue component as default.");
    }
    routes.push({
      path: "/login",
      component: loginViewModule.default
    });
  }

  const signOutViewModule = await loadOptionalModule(SIGN_OUT_VIEW_MODULES, "views/auth/SignOutView.vue");
  if (signOutViewModule) {
    if (!signOutViewModule.default) {
      throw new TypeError("views/auth/SignOutView.vue must export a Vue component as default.");
    }
    routes.push({
      path: "/auth/signout",
      component: signOutViewModule.default
    });
  }

  return routes;
}

export { initializeOptionalAuthGuardRuntime, listOptionalPublicAuthRoutes };
