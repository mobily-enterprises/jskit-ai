import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class ObservabilityRouteServiceProvider {
  static id = "observability.routes";

  static dependsOn = ["observability.core"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("ObservabilityRouteServiceProvider requires application has().");
    }
    if (!app.has("observabilityService")) {
      throw new Error("ObservabilityRouteServiceProvider requires observabilityService binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("ObservabilityRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      observabilityService: app.make("observabilityService")
    });

    const routes = buildRoutes({ observability: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { ObservabilityRouteServiceProvider };
