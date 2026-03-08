import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { UsersWorkspaceController } from "../controllers/UsersWorkspaceController.js";
import { UsersSettingsController } from "../controllers/UsersSettingsController.js";
import { buildRoutes as buildWorkspaceRoutes } from "../routes/workspaceRoutes.js";
import { buildRoutes as buildSettingsRoutes } from "../routes/settingsRoutes.js";

class UsersRouteServiceProvider {
  static id = "users.routes";

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("UsersRouteServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("UsersRouteServiceProvider requires authService binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("UsersRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("UsersRouteServiceProvider requires application make().");
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const actionExecutor = app.make("actionExecutor");
    const authService = app.make("authService");
    const consoleService = app.has("consoleService") ? app.make("consoleService") : null;

    const workspaceController = new UsersWorkspaceController({
      authService,
      actionExecutor,
      consoleService
    });
    const settingsController = new UsersSettingsController({
      authService,
      actionExecutor
    });

    const routes = [
      ...buildWorkspaceRoutes(workspaceController),
      ...buildSettingsRoutes(settingsController)
    ];

    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { UsersRouteServiceProvider };
