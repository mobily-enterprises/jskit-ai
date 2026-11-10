import { isProductionEnv } from "@jskit-ai/kernel/server/runtime/runtimeMode";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import {
  collectRequiredPermissions,
  describeUnknownRoleGrants,
  findUnknownRoleGrants
} from "./support/roleCatalogGrants.js";

/**
 * Checks, once every feature has registered its actions and routes, that each grant of the workspace role catalogue
 * covers a permission the application requires: an action's, a route's, a surface access policy's, or one the role
 * catalogue's `customPermissions` declares. A grant such as `crud.labels.patch`, which no action requires, would
 * otherwise leave a role silently refused (`ACTION_PERMISSION_DENIED`) where it was meant to be allowed. Outside
 * production the server refuses to start; in production, where the grant gives nothing and costs nothing, it starts
 * and logs a warning.
 */
const WorkspaceRoleGrantsProvider = defineProvider({
  id: "workspaces.role-grants",
  requires: {
    actions: "runtime.actions",
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http",
    logger: "runtime.logger",
    workspaces: "workspaces.core"
  },
  setup() {
    return {};
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} capabilities.actions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} capabilities.logger
   * @param {import("./types.js").WorkspacesCore} capabilities.workspaces
   */
  boot({ actions, config, env, http, logger, workspaces }) {
    // Without workspaces there are no memberships, so no role's permissions reach a request.
    if (!workspaces.enabled) {
      return;
    }
    const required = collectRequiredPermissions({ actions: actions.listDefinitions(), routes: http.router.list(), config });
    const findings = findUnknownRoleGrants(config, required);
    if (findings.length === 0) {
      return;
    }
    const message = describeUnknownRoleGrants(findings);
    if (isProductionEnv(env)) {
      logger.warn({ unknownRoleGrants: findings.map(({ roleId, grant }) => ({ roleId, grant })) }, message);
      return;
    }
    throw new Error(message);
  }
});

export { WorkspaceRoleGrantsProvider };
