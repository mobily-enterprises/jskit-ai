import { mountSurfaceApplication } from "./bootstrapRuntime.js";
import { createConsoleRouter } from "./router.console.js";

function mountConsoleApplication() {
  return mountSurfaceApplication({
    createRouter: createConsoleRouter,
    surface: "console"
  });
}

export { mountConsoleApplication };
