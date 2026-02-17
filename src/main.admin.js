import { mountSurfaceApplication } from "./bootstrapRuntime";
import { createAdminRouter } from "./router.admin";

function mountAdminApplication() {
  return mountSurfaceApplication({
    createRouter: createAdminRouter
  });
}

export { mountAdminApplication };
