import { TOKENS } from "@jskit-ai/support-core/tokens";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { createController, buildRoutes } from "../lib/index.js";

class CommunicationsRouteServiceProvider {
  static id = "communications.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("CommunicationsRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("CommunicationsRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("CommunicationsRouteServiceProvider requires application make()/has().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      communicationsService: app.has("communicationsService") ? app.make("communicationsService") : null,
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes(
      { communications: controller },
      {
        withStandardErrorResponses
      }
    );
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { CommunicationsRouteServiceProvider };
