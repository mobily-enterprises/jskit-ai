import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createAdminRouter } from "./router.admin.js";

function mountAdminApplication() {
  return mountSurfaceApplication({
    createRouter: ({ authStore, workspaceStore, consoleStore }) =>
      createAdminRouter({
        authStore,
        workspaceStore,
        consoleStore
      }),
    surface: "admin"
  });
}

export { mountAdminApplication };
