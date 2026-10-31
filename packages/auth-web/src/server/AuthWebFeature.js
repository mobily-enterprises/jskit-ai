import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthWeb } from "./authWeb.js";

const AuthWebFeature = defineFeature({
  id: "auth.web",
  domain: "auth",
  requires: {
    authService: "auth.service",
    env: "runtime.env",
    http: "runtime.http"
  },
  provides: {
    authWeb: "auth.web"
  },
  setup({ authService, env, http }) {
    const authWeb = createAuthWeb({ authService, env });
    for (const route of authWeb.routes) {
      http.router.register(route.method, route.path, route, route.handler);
    }
    return { authWeb };
  }
});

export { AuthWebFeature };
