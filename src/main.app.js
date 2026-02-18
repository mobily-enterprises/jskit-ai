import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createCustomerRouter } from "./router.app.js";

function mountAppApplication() {
  return mountSurfaceApplication({
    createRouter: createCustomerRouter
  });
}

export { mountAppApplication };
