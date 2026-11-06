import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthWeb } from "./authWeb.js";

const AuthWebFeature = defineFeature({
  id: "auth.web",
  domain: "auth",
  requires: {
    authService: "auth.service",
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http"
  },
  provides: {
    authWeb: "auth.web"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} capabilities.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   */
  setup({ authService, config, env, http }) {
    const authWeb = createAuthWeb({ authService, env, config });
    for (const route of authWeb.routes) {
      http.router.register(route.method, route.path, route, route.handler);
    }
    return { authWeb };
  }
});

export { AuthWebFeature };
