import { TOKENS } from "@jskit-ai/support-core/tokens";
import { buildRoutes, createController } from "../../shared/index.js";

class SettingsRouteServiceProvider {
  static id = "workspace.settings.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("SettingsRouteServiceProvider requires application has().");
    }
    if (!app.has("authService")) {
      throw new Error("SettingsRouteServiceProvider requires authService binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("SettingsRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("SettingsRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      authService: app.make("authService"),
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ settings: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { SettingsRouteServiceProvider };
