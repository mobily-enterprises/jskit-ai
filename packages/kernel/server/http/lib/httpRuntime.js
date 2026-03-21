import { KERNEL_TOKENS } from "../../../shared/support/tokens.js";
import { normalizeObject } from "../../../shared/support/normalize.js";
import { ensureApiErrorHandling } from "../../runtime/fastifyBootstrap.js";
import { resolveDefaultSurfaceId } from "../../support/appConfig.js";
import { RouteRegistrationError } from "./errors.js";
import { createRouter } from "./router.js";
import { registerRoutes } from "./routeRegistration.js";

function registerHttpRuntime(app, options = {}) {
  if (!app || typeof app.make !== "function") {
    throw new RouteRegistrationError("registerHttpRuntime requires an application instance.");
  }

  const runtimeOptions = normalizeObject(options);
  const {
    fastifyToken = KERNEL_TOKENS.Fastify,
    routerToken = KERNEL_TOKENS.HttpRouter,
    autoRegisterApiErrorHandling = true,
    apiErrorHandling = {},
    ...routeRegistrationOptions
  } = runtimeOptions;
  const fastify = app.make(fastifyToken);
  const router = app.make(routerToken);
  const routes = typeof router?.list === "function" ? router.list() : [];
  const resolvedDefaultActionSurface = resolveDefaultSurfaceId(app, {
    defaultSurfaceId: routeRegistrationOptions.requestActionDefaultSurface
  });

  if (autoRegisterApiErrorHandling !== false) {
    ensureApiErrorHandling(app, {
      fastifyToken,
      ...normalizeObject(apiErrorHandling)
    });
  }

  return registerRoutes(fastify, {
    ...routeRegistrationOptions,
    requestActionDefaultSurface: resolvedDefaultActionSurface,
    app,
    routes
  });
}

function createHttpRuntime(
  {
    app = null,
    fastify = null,
    router = null,
    autoRegisterApiErrorHandling = true,
    apiErrorHandling = {}
  } = {}
) {
  if (!app || typeof app.singleton !== "function") {
    throw new RouteRegistrationError("createHttpRuntime requires an application instance.");
  }

  const runtimeRouter = router || createRouter();
  app.singleton(KERNEL_TOKENS.HttpRouter, () => runtimeRouter);

  if (fastify) {
    app.instance(KERNEL_TOKENS.Fastify, fastify);
    if (autoRegisterApiErrorHandling !== false) {
      ensureApiErrorHandling(app, {
        fastifyToken: KERNEL_TOKENS.Fastify,
        ...normalizeObject(apiErrorHandling)
      });
    }
  }

  return {
    router: runtimeRouter,
    registerRoutes(runtimeOptions = {}) {
      return registerHttpRuntime(app, {
        autoRegisterApiErrorHandling,
        apiErrorHandling: normalizeObject(apiErrorHandling),
        ...normalizeObject(runtimeOptions)
      });
    }
  };
}

export { registerHttpRuntime, createHttpRuntime };
