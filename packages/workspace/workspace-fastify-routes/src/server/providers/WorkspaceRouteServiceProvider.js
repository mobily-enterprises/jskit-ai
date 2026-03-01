import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class WorkspaceRouteServiceProvider {
  static id = "workspace.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("WorkspaceRouteServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("WorkspaceRouteServiceProvider requires authService binding.");
    }
    if (!app.has("consoleService")) {
      throw new Error("WorkspaceRouteServiceProvider requires consoleService binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("WorkspaceRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("WorkspaceRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      authService: app.make("authService"),
      consoleService: app.make("consoleService"),
      actionExecutor: app.make("actionExecutor"),
      aiTranscriptsService: app.has("aiTranscriptsService") ? app.make("aiTranscriptsService") : null,
      realtimeEventsService: app.has("realtimeEventsService") ? app.make("realtimeEventsService") : null
    });

    const routes = buildRoutes({
      workspace: controller
    }, {});

    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { WorkspaceRouteServiceProvider };
