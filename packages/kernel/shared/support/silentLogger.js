/**
 * The logger of code whose caller may pass none: it logs nothing.
 * @type {import("../../server/types.js").RuntimeLogger}
 */
const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

export { silentLogger };
