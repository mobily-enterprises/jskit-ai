export type ClientLogger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  isDebugEnabled?: boolean;
};

export function getClientAppConfig(): Readonly<Record<string, any>>;
export function resolveMobileConfig(appConfig?: Record<string, any>): Readonly<Record<string, any>>;
export function resolveClientAssetMode(appConfig?: Record<string, any>): string;
export function normalizeIncomingAppUrl(
  url?: string,
  mobileConfig?: Record<string, any>,
  options?: {
    currentOrigin?: string;
    allowedHttpOrigins?: string[];
  }
): string;
export function registerMobileLaunchRouting(options?: {
  router: any;
  mobileConfig?: Record<string, any>;
  getInitialLaunchUrl?: () => Promise<string> | string;
  subscribeToLaunchUrls?: (handler: (url: string) => void) => (() => void) | void;
  currentOrigin?: string;
  allowedHttpOrigins?: string[];
  logger?: ClientLogger;
}): Readonly<{
  initialize: () => Promise<string>;
  dispose: () => void;
  applyIncomingUrl: (url?: string, reason?: string) => Promise<string>;
}>;

export function resolveClientBootstrapDebugEnabled(options?: {
  env?: Record<string, any>;
  debugEnabled?: boolean;
  debugEnvKey?: string;
}): boolean;

export function createShellRouter(options?: {
  createRouter: (options: { history?: any; routes: any[] }) => any;
  history?: any;
  routes?: any[];
  surfaceRuntime: any;
  surfaceMode?: string;
  fallbackRoute?: any;
  notFoundComponent?: any;
  guard?: false | ((to: any) => any) | Record<string, any>;
}): Readonly<{
  router: any;
  activeRoutes: readonly any[];
  fallbackRoute: any;
}>;

export function bootstrapClientShellApp(options?: {
  createApp: (rootComponent: any) => any;
  rootComponent: any;
  appConfig?: Record<string, any>;
  appPlugins?: any[];
  pinia?: any;
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
  onAfterRouterReady?: (context: any) => void | Promise<void>;
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

export function createComponentInteractionEmitter(
  emit: (eventName: string, payload: any) => void
): Readonly<{
  emitInteraction: (type: string, payload?: Record<string, any>) => void;
  invokeAction: (actionName: string, payload: any, callback?: () => Promise<any> | any) => Promise<void>;
}>;
