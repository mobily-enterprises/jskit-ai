/**
 * The logger a provider writes through: the application's logger, whose debug
 * messages are written with its info method only when debugEnabled is true.
 * @param {import("../../server/types.js").RuntimeLogger} logger
 * @param {{ debugEnabled?: boolean }} [options]
 */
function createProviderLogger(logger, { debugEnabled = false } = {}) {
  function info(...args) {
    logger.info(...args);
  }
  function warn(...args) {
    logger.warn(...args);
  }
  function error(...args) {
    logger.error(...args);
  }
  function debug(...args) {
    if (debugEnabled === true) {
      info(...args);
    }
  }
  return Object.freeze({ debug, info, warn, error });
}

export { createProviderLogger };
