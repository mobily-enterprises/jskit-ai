import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createService } from "../lib/service.js";

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

class ObservabilityServiceProvider {
  static id = "observability.core";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function" || typeof app.make !== "function") {
      throw new Error("ObservabilityServiceProvider requires application singleton()/has()/make().");
    }

    if (!app.has("observabilityService")) {
      app.singleton("observabilityService", (scope) => {
        const env = scope.has(TOKENS.Env) ? scope.make(TOKENS.Env) : {};
        const logger = scope.has(TOKENS.Logger) ? scope.make(TOKENS.Logger) : console;
        const metricsRegistry = scope.has("metricsRegistry") ? scope.make("metricsRegistry") : null;

        return createService({
          metricsRegistry,
          metricsEnabled: parseBooleanEnv(env.OBSERVABILITY_METRICS_ENABLED, true),
          metricsBearerToken: String(env.OBSERVABILITY_METRICS_BEARER_TOKEN || "").trim(),
          debugScopes: String(env.OBSERVABILITY_DEBUG_SCOPES || "").trim(),
          guardrailLogLabel: String(env.OBSERVABILITY_GUARDRAIL_LOG_LABEL || "guardrail.event").trim(),
          logger
        });
      });
    }
  }
}

export { ObservabilityServiceProvider };
