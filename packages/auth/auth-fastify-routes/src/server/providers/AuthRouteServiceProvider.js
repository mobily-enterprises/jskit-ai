import { TOKENS } from "@jskit-ai/support-core/tokens";
import { buildRoutes, createController } from "../../shared/index.js";

class AuthRouteServiceProvider {
  static id = "auth.routes";

  static dependsOn = ["auth.provider.supabase"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("AuthRouteServiceProvider requires application has().");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const authService = app.make("authService");
    const actionExecutor = app.make("actionExecutor");

    const controller = createController({
      authService,
      actionExecutor
    });

    const routes = buildRoutes({ auth: controller });
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { AuthRouteServiceProvider };
