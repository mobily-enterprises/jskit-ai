import { TOKENS } from "@jskit-ai/support-core/tokens";
import { buildRoutes, createController } from "../lib/index.js";

class ConsoleErrorsRouteServiceProvider {
  static id = "workspace.console-errors.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("ConsoleErrorsRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("ConsoleErrorsRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("ConsoleErrorsRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ consoleErrors: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { ConsoleErrorsRouteServiceProvider };
