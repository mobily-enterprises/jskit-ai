// The transactions handle calls may carry: those a handle's withTransaction opened (json-rest-api's own, which every
// handle call inside the work joins), and those a row policy's options name (see policyCallOptions).
const handleTransactions = new WeakSet();

/**
 * Records a transaction a handle's withTransaction opened, for the handle calls inside its work.
 * @param {object} trx
 */
function trackHandleTransaction(trx) {
  handleTransactions.add(trx);
}

// A call's options.trx, read or write, is one a handle's withTransaction opened, never a raw Knex transaction.
function requireHandleTransaction(name, options) {
  if (options.trx && !handleTransactions.has(options.trx)) {
    throw new TypeError(
      `${name}: options.trx is not a transaction a handle opened. A raw Knex transaction or savepoint cannot carry ` +
        "handle calls, reads included: run the work in withTransaction(options, work) and pass on the txOptions it gives work."
    );
  }
}

/**
 * A row policy's options: the call's own, with the transaction its read runs in. A write whose caller named no
 * transaction runs in one json-rest-api opens for it, and its row policy runs inside that one (the lookup before a
 * patch, the read-back after a create): the policy's options name it, so the handle calls the policy passes them to
 * join it instead of taking a second connection.
 * @param {Readonly<{ context: object | null, trx: object | null }> | undefined} callOptions The call's own.
 * @param {{ transaction?: object | null }} jsonRestContext The read's json-rest-api context.
 */
function policyCallOptions(callOptions, jsonRestContext) {
  const own = jsonRestContext.transaction;
  if (!callOptions || callOptions.trx || !own) {
    return callOptions;
  }
  handleTransactions.add(own);
  return Object.freeze({
    ...callOptions,
    trx: own
  });
}

export { policyCallOptions, requireHandleTransaction, trackHandleTransaction };
