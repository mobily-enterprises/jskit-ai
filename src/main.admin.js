import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createRouterForSurface } from "./router.js";

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
