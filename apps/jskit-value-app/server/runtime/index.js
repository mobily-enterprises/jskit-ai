import { createRepositories } from "./repositories.js";
import { createServices } from "./services.js";
import { createControllers } from "./controllers.js";
import { selectRuntimeServices } from "@jskit-ai/server-runtime-core/composition";

const RUNTIME_SERVICE_EXPORT_IDS = Object.freeze([
  "authService",
  "workspaceService",
  "consoleService",
  "consoleErrorsService",
  "realtimeEventsService",
  "observabilityService",
  "avatarStorageService",
  "chatAttachmentStorageService",
  "aiService",
  "billingService",
  "billingWebhookService",
  "billingOutboxWorkerService",
  "billingRemediationWorkerService",
  "billingReconciliationService",
  "billingWorkerRuntimeService"
]);

function createServerRuntime({
  runtimeEnv,
  repositoryConfig,
  nodeEnv,
  appConfig,
  rbacManifest,
  rootDir,
  supabasePublishableKey,
  observabilityRegistry
}) {
  const repositories = createRepositories();
  const services = createServices({
    repositories,
    env: runtimeEnv,
    repositoryConfig,
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
    runtimeServices: selectRuntimeServices(services, RUNTIME_SERVICE_EXPORT_IDS)
  };
}

export { createServerRuntime };
