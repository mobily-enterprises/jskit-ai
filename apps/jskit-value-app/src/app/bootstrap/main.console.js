import { mountSurfaceApplication } from "./runtime.js";
import { createRouterForSurface } from "../router/index.js";

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
