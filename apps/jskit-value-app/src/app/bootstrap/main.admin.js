import { mountSurfaceApplication } from "./runtime.js";
import { createRouterForSurface } from "../router/index.js";

function mountAdminApplication() {
  return mountSurfaceApplication({
    createRouter: ({ authStore, workspaceStore, consoleStore }) =>
      createRouterForSurface({
        authStore,
        workspaceStore,
        consoleStore,
        surface: "admin"
      }),
    surface: "admin"
  });
}

export { mountAdminApplication };
