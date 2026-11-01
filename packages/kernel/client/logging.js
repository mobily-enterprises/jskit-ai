/**
 * The client's logger: the given logger's methods, and isDebugEnabled, which
 * tells callers whether debug output goes anywhere so they can skip building
 * debug payloads. A logger may state it; otherwise it is true.
 * @param {import("../server/types.js").RuntimeLogger & { isDebugEnabled?: boolean }} logger
 */
function createStructuredLogger(logger) {
  return Object.freeze({
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    debug: logger.debug.bind(logger),
    isDebugEnabled: logger.isDebugEnabled ?? true
  });
}

function summarizeRouterRoutes(router) {
  if (!router || typeof router.getRoutes !== "function") {
    return Object.freeze([]);
  }

  return Object.freeze(
    router.getRoutes().map((route) =>
      Object.freeze({
        name: String(route?.name || "").trim(),
        path: String(route?.path || "").trim(),
        metaScope: String(route?.meta?.jskit?.scope || "").trim(),
        metaSurface: String(route?.meta?.jskit?.surface || "").trim()
      })
    )
  );
}

export { createStructuredLogger, summarizeRouterRoutes };
