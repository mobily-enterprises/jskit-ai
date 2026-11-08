// What a call's options hand on, in a module of its own that loads nothing else, so code that must load without the
// table runtime (an assistant on file storage, say) passes options on as every handle does.

/**
 * What a call hands on to the work it runs (withTransaction's work, an afterWrite hook, a handle's own nested calls):
 * its context and transaction. Its settings (format, missing, returning, lockVersion and the rest) are for that one
 * call, so they never reach a call they were not named on.
 * @param {{ context?: object | null, trx?: object | null }} options
 * @returns {Readonly<{ context?: object | null, trx?: object }>}
 */
function passedOn(options) {
  return Object.freeze({
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.trx ? { trx: options.trx } : {})
  });
}

export { passedOn };
