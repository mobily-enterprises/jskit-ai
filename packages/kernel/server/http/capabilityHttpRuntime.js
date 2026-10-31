import {
  normalizeRouteVisibility,
  normalizeRouteVisibilityToken,
  normalizeVisibilityContext
} from "../../shared/support/visibility.js";
import { normalizeText } from "../../shared/support/normalize.js";
import { createRouter } from "./lib/router.js";
import { registerRoutes } from "./lib/routeRegistration.js";
import {
  registerApiErrorHandler,
  registerBodylessContentTypeNormalizer
} from "./errorHandling.js";
import { isAppError } from "../runtime/errors.js";

/** @typedef {import("../types.js").ActionCatalogue} ActionCatalogue */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */

function normalizeResolver({ id, resolve } = {}) {
  const resolverId = normalizeText(id);
  if (!resolverId) {
    throw new TypeError("HTTP visibility resolver id is required.");
  }
  if (typeof resolve !== "function") {
    throw new TypeError(`HTTP visibility resolver "${resolverId}" requires resolve().`);
  }
  return Object.freeze({ id: resolverId, resolve });
}

// The runtime.http capability: the routes features register, served by the
// application's Fastify instance once the runtime starts.
/**
 * @param {object} dependencies
 * @param {RuntimeFastify} dependencies.fastify
 * @param {ActionCatalogue} dependencies.actions
 */
function createCapabilityHttpRuntime({ fastify, actions }) {
  const router = createRouter();
  const visibilityResolvers = [];
  const visibilityResolverIds = new Set();
  let started = false;
  let registration = null;

  function assertOpen() {
    if (started) {
      throw new Error("HTTP runtime registration is closed after startup.");
    }
  }

  function registerVisibilityResolver(value) {
    assertOpen();
    const resolver = normalizeResolver(value);
    if (visibilityResolverIds.has(resolver.id)) {
      throw new Error(`HTTP visibility resolver "${resolver.id}" is duplicated.`);
    }
    visibilityResolverIds.add(resolver.id);
    visibilityResolvers.push(resolver);
    return api;
  }

  actions.registerContextContributor({
    id: "runtime.http.visibility",
    async contribute({ actionId, version, definition, input, context }) {
      const visibility = normalizeRouteVisibilityToken(context.routeVisibility);
      const patch = {};
      for (const resolver of visibilityResolvers) {
        const contribution = await resolver.resolve(Object.freeze({
          request: context.requestMeta?.request || null,
          visibility,
          context,
          input,
          actionId,
          version,
          definition,
          channel: normalizeText(context.channel).toLowerCase() || "api"
        }));
        if (contribution && typeof contribution === "object" && !Array.isArray(contribution)) {
          Object.assign(patch, contribution);
        }
      }
      const coreVisibility = normalizeRouteVisibility(visibility);
      const visibilityContext = normalizeVisibilityContext({
        ...patch,
        visibility,
        requiresActorScope: patch.requiresActorScope === true || coreVisibility === "user"
      });
      return {
        visibilityContext,
        requestMeta: {
          visibilityContext,
          routeVisibility: visibilityContext.visibility
        }
      };
    }
  });

  function start(options = {}) {
    assertOpen();
    started = true;
    registerBodylessContentTypeNormalizer(fastify);
    registerApiErrorHandler(fastify, { isAppError });
    registration = Object.freeze(registerRoutes(fastify, {
      ...options,
      actions,
      routes: router.list()
    }));
    return registration;
  }

  function diagnostics() {
    return Object.freeze({
      started,
      routeCount: registration?.routeCount || router.list().filter((route) => route.internal !== true).length,
      visibilityResolverIds: Object.freeze([...visibilityResolverIds].sort())
    });
  }

  const api = Object.freeze({
    router,
    registerVisibilityResolver,
    start,
    diagnostics
  });
  return api;
}

export { createCapabilityHttpRuntime };
