import { createController, buildRoutes } from "./index.js";

function createServerContributions() {
  return {
    repositories: [],
    services: [],
    controllers: [
      {
        id: "chat",
        create({ services = {}, runtimeServices = {}, dependencies = {} } = {}) {
          try {
            return createController({
              ...dependencies,
              ...services,
              ...runtimeServices
            });
          } catch {
            return {};
          }
        }
      }
    ],
    routes: [
      {
        id: "chat",
        resolveOptions({ routeConfig = {}, missingHandler = null } = {}) {
          const options = routeConfig && typeof routeConfig === "object" ? routeConfig : {};
          return {
            ...options,
            ...(typeof missingHandler === "function" ? { missingHandler } : {})
          };
        },
        buildRoutes(controllers, options = {}) {
          return buildRoutes(controllers, options);
        }
      }
    ],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  };
}

export { createServerContributions };
