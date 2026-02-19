import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createRouterForSurface } from "./router.js";

function mountAppApplication() {
  return mountSurfaceApplication({
    createRouter: ({ authStore, workspaceStore, consoleStore }) =>
      createRouterForSurface({
        authStore,
        workspaceStore,
        consoleStore,
        surface: "app"
      }),
    surface: "app"
  });
}

export { mountAppApplication };
