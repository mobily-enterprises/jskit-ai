/**
 * The application's logger as realtime logs through it: debug() reaches the
 * application's info level while realtime debugging is on, and nothing otherwise.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} options.logger
 * @param {boolean} options.debugEnabled
 */
function createRealtimeLogger({ logger, debugEnabled }) {
  function debug(...args) {
    if (debugEnabled) logger.info(...args);
  }

  function info(...args) {
    logger.info(...args);
  }

  function warn(...args) {
    logger.warn(...args);
  }

  function error(...args) {
    logger.error(...args);
  }

  return Object.freeze({ debug, info, warn, error });
}

export { createRealtimeLogger };
