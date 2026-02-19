import { createRepositories } from "./repositories.js";
import { createServices } from "./services.js";
import { createControllers } from "./controllers.js";

function createServerRuntime({ env, nodeEnv, appConfig, rbacManifest, rootDir, supabasePublishableKey, observabilityRegistry }) {
  const repositories = createRepositories();
  const services = createServices({
    repositories,
    env,
    nodeEnv,
    appConfig,
    rbacManifest,
    rootDir,
    supabasePublishableKey,
    observabilityRegistry
  });
  const controllers = createControllers({ services });

  return {
    controllers,
    runtimeServices: {
      authService: services.authService,
      workspaceService: services.workspaceService,
      consoleService: services.consoleService,
      consoleErrorsService: services.consoleErrorsService,
      realtimeEventsService: services.realtimeEventsService,
      observabilityService: services.observabilityService,
      avatarStorageService: services.avatarStorageService
    }
  };
}

export { createServerRuntime };
