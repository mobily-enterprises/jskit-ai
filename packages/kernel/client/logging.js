import { isRecord } from "../shared/support/normalize.js";

// isDebugEnabled tells callers whether debug output goes anywhere, so they
// can skip building debug payloads. A logger may state it; otherwise it is
// true exactly when the logger has its own debug method.
function createStructuredLogger(logger = console) {
  if (isRecord(logger)) {
    const hasDebug = typeof logger.debug === "function";
    return Object.freeze({
      info: typeof logger.info === "function" ? logger.info.bind(logger) : console.info.bind(console),
      warn: typeof logger.warn === "function" ? logger.warn.bind(logger) : console.warn.bind(console),
      error: typeof logger.error === "function" ? logger.error.bind(logger) : console.error.bind(console),
      debug: hasDebug ? logger.debug.bind(logger) : () => {},
      isDebugEnabled: typeof logger.isDebugEnabled === "boolean" ? logger.isDebugEnabled : hasDebug
    });
  }

  return Object.freeze({
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: () => {},
    isDebugEnabled: false
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
