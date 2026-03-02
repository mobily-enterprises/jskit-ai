import { mountSurfaceApplication } from "./runtime.js";
import { createAppRouter } from "../router/app.js";

function mountAppApplication() {
  return mountSurfaceApplication({
    createRouter: ({ authStore, workspaceStore, consoleStore }) =>
      createAppRouter({
        authStore,
        workspaceStore,
        consoleStore
      }),
    surface: "app"
  });
}

export { mountAppApplication };
