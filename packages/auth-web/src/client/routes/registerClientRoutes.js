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
      componentPath: "/src/views/auth/LoginView.vue",
      meta: {
        guard: {
          policy: "public"
        }
      }
    },
    {
      id: "auth.signout",
      name: "auth-signout",
      path: "/auth/signout",
      scope: "global",
      componentPath: "/src/views/auth/SignOutView.vue",
      meta: {
        guard: {
          policy: "public"
        }
      }
    }
  ]);
}

export { registerClientRoutes };
