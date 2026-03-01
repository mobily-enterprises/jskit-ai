import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class ChatRouteServiceProvider {
  static id = "chat.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("ChatRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("ChatRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("ChatRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ chat: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { ChatRouteServiceProvider };
