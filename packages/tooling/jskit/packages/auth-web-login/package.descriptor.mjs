export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/auth-web-login",
  version: "0.1.0",
  description: "Scaffolds app-owned login and signout views plus auth guard runtime for web-shell apps.",
  dependsOn: ["@jskit-ai/access-core"],
  capabilities: {
    provides: ["auth.web-login"],
    requires: []
  },
  metadata: {
    server: {
      routes: []
    },
    ui: {
      routes: [
        {
          path: "/login",
          surface: "app",
          name: "login",
          purpose: "Public login route for authentication flows."
        },
        {
          path: "/auth/signout",
          surface: "app",
          name: "auth-signout",
          purpose: "Public sign-out route that clears session then returns to login."
        }
      ],
      elements: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-client-runtime": "0.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/views/login/LoginView.vue",
        to: "src/views/login/LoginView.vue",
        reason: "Install app-owned login view scaffold for auth flows.",
        category: "auth-web",
        id: "auth-view-login"
      },
      {
        from: "templates/src/views/auth/SignOutView.vue",
        to: "src/views/auth/SignOutView.vue",
        reason: "Install app-owned sign-out route view scaffold.",
        category: "auth-web",
        id: "auth-view-signout"
      },
      {
        from: "templates/src/runtime/authHttpClient.js",
        to: "src/runtime/authHttpClient.js",
        reason: "Provide shared auth HTTP client with CSRF token support.",
        category: "auth-web",
        id: "auth-runtime-http-client"
      },
      {
        from: "templates/src/runtime/authGuardRuntime.js",
        to: "src/runtime/authGuardRuntime.js",
        reason: "Provide auth guard runtime integration for protected shell routes.",
        category: "auth-web",
        id: "auth-runtime-guard"
      },
      {
        from: "templates/src/runtime/useSignOut.js",
        to: "src/runtime/useSignOut.js",
        reason: "Provide reusable sign-out flow helper for layouts and auth views.",
        category: "auth-web",
        id: "auth-runtime-signout"
      }
    ]
  }
});
