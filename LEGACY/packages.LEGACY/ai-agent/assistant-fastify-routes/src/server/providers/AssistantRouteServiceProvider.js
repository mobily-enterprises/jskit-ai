import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../../lib/index.js";

class AssistantRouteServiceProvider {
  static id = "assistant.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("AssistantRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("AssistantRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AssistantRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ ai: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { AssistantRouteServiceProvider };
