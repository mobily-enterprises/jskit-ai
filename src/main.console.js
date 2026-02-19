import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createRouterForSurface } from "./router.js";

function mountConsoleApplication() {
  return mountSurfaceApplication({
    createRouter: ({ authStore, workspaceStore, consoleStore }) =>
      createRouterForSurface({
        authStore,
        workspaceStore,
        consoleStore,
        surface: "console"
      }),
    surface: "console"
  });
}

export { mountConsoleApplication };
