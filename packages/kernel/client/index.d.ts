export const AUTH_POLICY_AUTHENTICATED: "authenticated";
export const AUTH_POLICY_PUBLIC: "public";
export const WEB_ROOT_ALLOW_YES: "yes";
export const WEB_ROOT_ALLOW_NO: "no";
export const DEFAULT_GUARD_EVALUATOR_KEY: string;

export type ClientLogger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  isDebugEnabled?: boolean;
};

export type SurfaceGuardConfig = {
  surfaceDefinitions?: Record<string, any>;
  defaultSurfaceId?: string;
  webRootAllowed?: string;
  guardEvaluatorKey?: string;
  authenticatedPolicy?: string;
  publicPolicy?: string;
  [key: string]: any;
};

export function createFallbackNotFoundRoute(component: any): Readonly<any>;
export function buildSurfaceAwareRoutes(options?: {
  routes?: any[];
  surfaceRuntime: any;
  surfaceMode?: string;
  fallbackRoute?: any;
  notFoundComponent?: any;
}): any[];
export function createShellBeforeEachGuard(options?: {
  surfaceRuntime: any;
  surfaceDefinitions: Record<string, any>;
  defaultSurfaceId?: string;
  webRootAllowed?: string;
  guardEvaluatorKey?: string;
  authenticatedPolicy?: string;
  publicPolicy?: string;
}): (to: any) => any;

export const CLIENT_MODULE_RUNTIME_APP_TOKEN: symbol;
export const CLIENT_MODULE_ROUTER_TOKEN: symbol;
export const CLIENT_MODULE_VUE_APP_TOKEN: symbol;
export const CLIENT_MODULE_ENV_TOKEN: symbol;
export const CLIENT_MODULE_SURFACE_RUNTIME_TOKEN: symbol;
export const CLIENT_MODULE_SURFACE_MODE_TOKEN: symbol;
export const CLIENT_MODULE_LOGGER_TOKEN: symbol;

export function createClientRuntimeApp(options?: {
  profile?: string;
  app?: any;
  router?: any;
  env?: Record<string, any>;
  logger?: ClientLogger;
  surfaceRuntime?: any;
  surfaceMode?: string;
}): any;

export function registerClientModuleRoutes(options?: {
  packageId: string;
  routes?: any[];
  router: any;
  surfaceRuntime: any;
  surfaceMode?: string;
  seenRoutePaths: Set<string>;
  seenRouteNames: Set<string>;
  logger?: ClientLogger;
  source?: string;
  descriptorRouteDeclarations?: any;
}): Readonly<{
  packageId: string;
  source: string;
  declaredCount: number;
  registeredCount: number;
  declaredPaths: readonly string[];
  activePaths: readonly string[];
}>;

export function bootClientModules(options?: {
  clientModules?: any[];
  app?: any;
  router: any;
  surfaceRuntime: any;
  surfaceMode?: string;
  env?: Record<string, any>;
  logger?: ClientLogger;
}): Promise<
  Readonly<{
    runtimeApp: any;
    modules: readonly string[];
    bootedPackages: readonly string[];
    providerCount: number;
    routeResults: readonly any[];
    routeCount: number;
  }>
>;

export function resolveClientBootstrapDebugEnabled(options?: {
  env?: Record<string, any>;
  debugEnabled?: boolean;
  debugEnvKey?: string;
}): boolean;

export function createClientBootstrapLogger(options?: {
  env?: Record<string, any>;
  logger?: ClientLogger;
  debugEnabled?: boolean;
  debugEnvKey?: string;
}): Readonly<Required<ClientLogger>>;

export function createSurfaceShellRouter(options?: {
  createRouter: (options: { history?: any; routes: any[] }) => any;
  history?: any;
  routes?: any[];
  surfaceRuntime: any;
  surfaceMode?: string;
  fallbackRoute?: any;
  notFoundComponent?: any;
  guard?: false | ((to: any) => any) | SurfaceGuardConfig;
}): Readonly<{
  router: any;
  activeRoutes: readonly any[];
  fallbackRoute: any;
}>;

export const createShellRouter: typeof createSurfaceShellRouter;

export function bootstrapClientShellApp(options?: {
  createApp: (rootComponent: any) => any;
  rootComponent: any;
  appPlugins?: any[];
  router: any;
  bootClientModules: (context: any) => Promise<any>;
  surfaceRuntime: any;
  surfaceMode?: string;
  env?: Record<string, any>;
  fallbackRoute?: any;
  logger?: ClientLogger;
  createBootstrapLogger?: (options: {
    env?: Record<string, any>;
    logger?: ClientLogger;
    debugEnabled?: boolean;
    debugEnvKey?: string;
  }) => ClientLogger;
  debugEnabled?: boolean;
  debugEnvKey?: string;
  debugMessage?: string;
  onAfterModulesBootstrapped?: (context: any) => void | Promise<void>;
  mountSelector?: string;
}): Promise<
  Readonly<{
    app: any;
    router: any;
    clientBootstrap: any;
    logger: Required<ClientLogger>;
    debugEnabled: boolean;
  }>
>;
