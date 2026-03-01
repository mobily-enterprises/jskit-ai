import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../../shared/index.js";

function createDefaultHealthService() {
  return Object.freeze({
    async health() {
      return {
        ok: true
      };
    },
    async readiness() {
      return {
        ok: true,
        checks: {}
      };
    }
  });
}

class HealthRouteServiceProvider {
  static id = "runtime.health.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("HealthRouteServiceProvider requires application container methods.");
    }

    if (!app.has(TOKENS.HealthService)) {
      app.singleton(TOKENS.HealthService, () => createDefaultHealthService());
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("HealthRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const healthService = app.make(TOKENS.HealthService);

    const controller = createController({
      healthService
    });

    const routes = buildRoutes({ health: controller });
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { HealthRouteServiceProvider };
