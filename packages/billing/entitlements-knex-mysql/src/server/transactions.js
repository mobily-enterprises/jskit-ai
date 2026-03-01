function assertTransactionCallback(fn) {
  if (typeof fn !== "function") {
    throw new Error("withTransaction requires a callback function.");
  }
}

export async function withTransaction(knex, fn) {
  assertTransactionCallback(fn);

  const client = knex && (typeof knex === "function" || typeof knex === "object") ? knex : null;
  if (!client) {
    throw new Error("withTransaction requires a Knex instance or transaction object.");
  }

  if (typeof client.transaction === "function") {
    return client.transaction(async (trx) => fn(trx));
  }

  return fn(client);
}
