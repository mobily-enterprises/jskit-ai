// readable-check: allow no-transaction-reader - infrastructure: passedOn is the data-access runtime's own reader of a call's transaction, the one every handle and withTransaction use

// What a call's options hand on, in a module that imports nothing, so code that loads without the table runtime (an
// assistant on file storage, where @jskit-ai/resource-runtime is not installed) passes options on as every handle does.
// @jskit-ai/resource-runtime/server re-exports it.

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
