/**
 * Refuses a callback option that was given but is not a function, naming the entry and the option.
 * An option left out has already taken its named default. A wrong value fails here, where the
 * options arrive, instead of inside a model step, where the AI SDK drops the error.
 * @param {string} entry
 * @param {Record<string, unknown>} callbacks
 */
export function assertCallbacks(entry, callbacks) {
  for (const [name, callback] of Object.entries(callbacks)) {
    // readable-check: allow method-probe - input validation: the callbacks an application passes the agent engine
    if (typeof callback !== "function") throw new TypeError(`${entry}: ${name} must be a function, or left out for its default.`);
  }
}
