import { createController, buildRoutes } from "./index.js";

function createServerContributions() {
  return {
    repositories: [],
    services: [],
    controllers: [
      {
        id: "settings",
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
        id: "settings",
        resolveOptions({ routeConfig = {} } = {}) {
          return routeConfig && typeof routeConfig === "object" ? routeConfig : {};
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
