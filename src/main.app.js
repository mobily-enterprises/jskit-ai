import { mountSurfaceApplication } from "./bootstrapRuntime";
import { createCustomerRouter } from "./router.app";

function mountAppApplication() {
  return mountSurfaceApplication({
    createRouter: createCustomerRouter
  });
}

export { mountAppApplication };
