import { ARCHITECTURE_ID_PATTERN } from "../../shared/capabilities/defineProvider.js";

/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 2000;

/**
 * The application's health checks, which providers register, such as the database's: each one
 * passes when it resolves within the timeout. A failure is logged, and the result says only which
 * checks passed, so a public health route reveals no error details.
 * @param {object} options
 * @param {RuntimeLogger} options.logger
 * @param {number} [options.timeoutMs]
 */
function createHealthRuntime({ logger, timeoutMs = DEFAULT_HEALTH_CHECK_TIMEOUT_MS }) {
  /** @type {Map<string, () => unknown>} */
  const checks = new Map();
  /**
   * The checks running now: requests that arrive while a check runs share its result, so a health
   * route that anyone can call never runs more than one of each check at a time.
   * @type {Map<string, Promise<boolean>>}
   */
  const running = new Map();

  /**
   * @param {string} id
   * @param {() => unknown} check Resolves when healthy; rejects or hangs when not.
   */
  function register(id, check) {
    if (!ARCHITECTURE_ID_PATTERN.test(id)) {
      throw new TypeError(`Health check id "${id}" must be lowercase, such as "database".`);
    }
    // readable-check: allow method-probe - input validation: a registered check must be a function
    if (typeof check !== "function") {
      throw new TypeError(`Health check "${id}" must be a function.`);
    }
    if (checks.has(id)) {
      throw new Error(`Health check "${id}" is already registered.`);
    }
    checks.set(id, check);
  }

  /**
   * @param {string} id
   * @param {() => unknown} check
   */
  async function runCheck(id, check) {
    let timer;
    /** @type {Promise<boolean>} */
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      const passed = await Promise.race([Promise.resolve().then(check).then(() => true), timedOut]);
      if (!passed) {
        logger.warn({ healthCheck: id, timeoutMs }, "Health check timed out.");
      }
      return passed;
    } catch (error) {
      logger.warn({ healthCheck: id, err: error }, "Health check failed.");
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} id
   * @param {() => unknown} check
   */
  function runShared(id, check) {
    let run = running.get(id);
    if (!run) {
      run = runCheck(id, check).finally(() => running.delete(id));
      running.set(id, run);
    }
    return run;
  }

  /**
   * Runs every check. ok is true when all of them pass, and when there are none.
   * @returns {Promise<{ ok: boolean, checks: Record<string, { ok: boolean }> }>}
   */
  async function check() {
    const entries = [...checks];
    const passed = await Promise.all(entries.map(([id, healthCheck]) => runShared(id, healthCheck)));
    return Object.freeze({
      ok: passed.every(Boolean),
      checks: Object.freeze(Object.fromEntries(entries.map(([id], index) => [id, Object.freeze({ ok: passed[index] })])))
    });
  }

  return Object.freeze({
    register,
    check
  });
}

export { createHealthRuntime };
