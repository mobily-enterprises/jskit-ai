import { createService } from "./service.js";

function parseBooleanEnv(value, fallback = true) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function createServerContributions() {
  return {
    repositories: [],
    services: [
      {
        id: "observabilityService",
        create({ services = {}, dependencies = {} } = {}) {
          const envFromDependencies =
            dependencies?.env && typeof dependencies.env === "object" ? dependencies.env : {};
          const env = {
            ...process.env,
            ...envFromDependencies
          };
          return createService({
            metricsRegistry: services.metricsRegistry || null,
            metricsEnabled: parseBooleanEnv(env.OBSERVABILITY_METRICS_ENABLED, true),
            metricsBearerToken: String(env.OBSERVABILITY_METRICS_BEARER_TOKEN || "").trim(),
            debugScopes: String(env.OBSERVABILITY_DEBUG_SCOPES || "").trim(),
            guardrailLogLabel: String(env.OBSERVABILITY_GUARDRAIL_LOG_LABEL || "guardrail.event").trim(),
            logger: dependencies?.logger || console
          });
        }
      }
    ],
    controllers: [],
    routes: [],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  };
}

export { createServerContributions };
