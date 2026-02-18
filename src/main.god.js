import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createGodRouter } from "./router.god.js";

function mountGodApplication() {
  return mountSurfaceApplication({
    createRouter: createGodRouter
  });
}

export { mountGodApplication };
