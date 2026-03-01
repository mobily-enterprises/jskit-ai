import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { createController, buildRoutes } from "./index.js";

function createServerContributions() {
  return {
    repositories: [],
    services: [],
    controllers: [
      {
        id: "communications",
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
        id: "communications",
        resolveOptions({ routeConfig = {}, missingHandler = null } = {}) {
          const options = routeConfig && typeof routeConfig === "object" ? routeConfig : {};
          return {
            ...options,
            withStandardErrorResponses:
              typeof options.withStandardErrorResponses === "function"
                ? options.withStandardErrorResponses
                : withStandardErrorResponses,
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
