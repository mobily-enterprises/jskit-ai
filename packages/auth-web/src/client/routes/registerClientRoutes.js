function resolveViewComponent(viewModule, viewModulePath) {
  if (!viewModule || typeof viewModule !== "object" || !viewModule.default) {
    throw new Error(`Auth web route view module did not export default component: ${viewModulePath}`);
  }
  return viewModule.default;
}

function registerClientRoutes({ registerRoutes } = {}) {
  if (typeof registerRoutes !== "function") {
    throw new Error("auth-web registerClientRoutes requires registerRoutes().");
  }

  registerRoutes([
    {
      id: "auth.login",
      name: "auth-login",
      path: "/auth/login",
      scope: "global",
      component: () =>
        import("/src/views/auth/LoginView.vue").then((module) =>
          resolveViewComponent(module, "/src/views/auth/LoginView.vue")
        )
    },
    {
      id: "auth.signout",
      name: "auth-signout",
      path: "/auth/signout",
      scope: "global",
      component: () =>
        import("/src/views/auth/SignOutView.vue").then((module) =>
          resolveViewComponent(module, "/src/views/auth/SignOutView.vue")
        )
    }
  ]);
}

export { registerClientRoutes };
