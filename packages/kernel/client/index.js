export {
  AUTH_POLICY_AUTHENTICATED,
  AUTH_POLICY_PUBLIC,
  WEB_ROOT_ALLOW_YES,
  WEB_ROOT_ALLOW_NO,
  DEFAULT_GUARD_EVALUATOR_KEY,
  createFallbackNotFoundRoute,
  buildSurfaceAwareRoutes,
  createShellBeforeEachGuard
} from "./shellRouting.js";
export {
  CLIENT_MODULE_RUNTIME_APP_TOKEN,
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN,
  CLIENT_MODULE_ENV_TOKEN,
  CLIENT_MODULE_SURFACE_RUNTIME_TOKEN,
  CLIENT_MODULE_SURFACE_MODE_TOKEN,
  CLIENT_MODULE_LOGGER_TOKEN,
  createClientRuntimeApp,
  registerClientModuleRoutes,
  bootClientModules
} from "./moduleBootstrap.js";
export {
  resolveClientBootstrapDebugEnabled,
  createClientBootstrapLogger,
  createSurfaceShellRouter,
  createSurfaceShellRouter as createShellRouter,
  bootstrapClientShellApp
} from "./shellBootstrap.js";
