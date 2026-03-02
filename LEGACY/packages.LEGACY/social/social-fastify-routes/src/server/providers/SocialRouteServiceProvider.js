import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class SocialRouteServiceProvider {
  static id = "social.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("SocialRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("SocialRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("SocialRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ social: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { SocialRouteServiceProvider };
