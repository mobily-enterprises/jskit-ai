import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { USERS_SURFACE_RUNTIME_TOKEN } from "@jskit-ai/users-core/server/providers/UsersCoreServiceProvider";
import { UsersWorkspaceController } from "../controllers/UsersWorkspaceController.js";
import { UsersSettingsController } from "../controllers/UsersSettingsController.js";
import { UsersConsoleSettingsController } from "../controllers/UsersConsoleSettingsController.js";
import { buildRoutes as buildWorkspaceRoutes } from "../routes/workspaceRoutes.js";
import { buildRoutes as buildSettingsRoutes } from "../routes/settingsRoutes.js";
import { buildRoutes as buildConsoleSettingsRoutes } from "../routes/consoleSettingsRoutes.js";

class UsersRouteServiceProvider {
  static id = "users.routes";

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("UsersRouteServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("UsersRouteServiceProvider requires authService binding.");
    }
    if (!app.has("users.workspace.service")) {
      throw new Error("UsersRouteServiceProvider requires users.workspace.service binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("UsersRouteServiceProvider requires actionExecutor binding.");
    }
    if (!app.has(USERS_SURFACE_RUNTIME_TOKEN)) {
      throw new Error(`UsersRouteServiceProvider requires ${USERS_SURFACE_RUNTIME_TOKEN} binding.`);
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("UsersRouteServiceProvider requires application make().");
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const authService = app.make("authService");
    const workspaceService = app.make("users.workspace.service");
    const consoleService = app.has("consoleService") ? app.make("consoleService") : null;
    const surfaceRuntime = app.make(USERS_SURFACE_RUNTIME_TOKEN);
    const workspaceSurfaceDefinitions =
      typeof surfaceRuntime.listSurfaceDefinitions === "function"
        ? surfaceRuntime
            .listSurfaceDefinitions({ enabledOnly: true })
            .filter((definition) => Boolean(definition?.requiresWorkspace))
            .map((definition) => ({
              id: definition.id,
              prefix: definition.prefix
            }))
        : [];

    const workspaceController = new UsersWorkspaceController({
      authService,
      workspaceService,
      consoleService
    });
    const settingsController = new UsersSettingsController({
      authService
    });
    const consoleSettingsController = new UsersConsoleSettingsController();

    const routes = [
      ...buildWorkspaceRoutes(workspaceController, {
        workspaceSurfaceDefinitions
      }),
      ...buildSettingsRoutes(settingsController),
      ...buildConsoleSettingsRoutes(consoleSettingsController)
    ];

    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { UsersRouteServiceProvider };
