import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthPolicy } from "../authPolicy.js";
import { authPolicyPlugin } from "../lib/plugin.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";
import { createAuthRouteVisibilityResolver } from "../lib/routeVisibilityResolver.js";

const AuthPolicyProvider = defineProvider({
  id: "auth.policy",
  requires: {
    actions: "runtime.actions",
    extensions: "auth.extensions",
    fastify: "runtime.fastify",
    http: "runtime.http",
    env: "runtime.env"
  },
  optional: {
    authService: "auth.service"
  },
  provides: {
    policy: "auth.policy"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} capabilities.actions
   * @param {import("../types.js").AuthService | null} capabilities.authService The installed provider's `auth.service`, when there is one.
   * @param {import("../types.js").AuthExtensions} capabilities.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   */
  setup({ actions, authService, extensions, http, env }) {
    const actionContext = createAuthActionContextContributor();
    actions.registerContextContributor({
      id: actionContext.contributorId,
      contribute: actionContext.contribute
    });
    const visibility = createAuthRouteVisibilityResolver();
    http.registerVisibilityResolver({
      id: visibility.resolverId,
      resolve: visibility.resolve
    });
    return { policy: createAuthPolicy({ authService, extensions, env }) };
  },
  async boot({ fastify }, { outputs }) {
    const policy = outputs.policy;
    await authPolicyPlugin(
      {
        resolveActor: policy.resolveActor,
        resolveContext: policy.resolveContext,
        hasPermission: policy.hasPermission
      },
      policy.options
    )(fastify);
  }
});

export { AuthPolicyProvider };
