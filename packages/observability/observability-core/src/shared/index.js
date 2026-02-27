export { createBrowserErrorPayloadTools } from "./browserPayload.js";
export { createConsoleErrorPayloadNormalizer, SERVER_SIMULATION_KINDS } from "./serverPayload.js";
export { createApi as createConsoleErrorsApi } from "./client/consoleErrorsApi.js";
export {
  BROWSER_ERRORS_READ_PERMISSION,
  SERVER_ERRORS_READ_PERMISSION,
  normalizePagination,
  normalizeErrorEntryId,
  normalizeBrowserPayload,
  normalizeServerPayload,
  normalizeSimulationKind,
  createService as createConsoleErrorsService
} from "./consoleErrors.service.js";
export { normalizeMetricLabel } from "./metricsContracts.js";
export { createMetricsRegistry } from "./metricsRegistry.js";
export { createScopeDebugMatcher, createScopedLogger } from "./scopeLogger.js";
export { createService } from "./service.js";
export { createController } from "./fastify/controller.js";
export { buildRoutes } from "./fastify/routes.js";
export { schema } from "./fastify/schema.js";
