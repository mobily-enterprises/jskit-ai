import { mountSurfaceApplication } from "./runtime.js";
import { createRouterForSurface } from "../router/index.js";

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
