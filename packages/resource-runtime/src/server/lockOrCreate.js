import { isDeadlockError, isDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// First uses of one id at once can collide on its insert before any work runs (on MySQL and MariaDB, first uses of
// neighbouring ids too, through their gap locks): each collision runs the loser again after a short random wait.
const CREATE_RACE_ATTEMPTS = 4;
const CREATE_IF_MISSING = Object.freeze({ keys: ["id"], action: "ignore" });

/**
 * A handle's lockOrCreate(row, options, work): runs work on the record with `row.id`, locked until the transaction
 * ends, creating it from `row` first when it is missing, in the transaction with the work, so work that fails leaves
 * no record behind. The table has no owners (the insert is an upsert keyed on the id). In the caller's transaction
 * (`options.trx`) it runs work there once. Otherwise it opens a transaction of its own: two first uses of one id at
 * once can collide on the insert before either work runs (a deadlock, or a duplicate key), and the loser runs again,
 * up to four runs in all, and finds the winner's record. Work that has started never runs again, so it may call a
 * provider. The id is one the server computes or generates, never one a request supplies: when a row policy hides the
 * record with that id, the insert is skipped and the lock answers not found, which still tells the caller it exists.
 * @template T
 * @param {Pick<import("./types.js").ResourceHandle, "name" | "withTransaction" | "lock" | "createMany">} handle
 * @param {{ id: unknown } & Record<string, unknown>} row
 * @param {{ context?: object | null, trx?: object | null }} options
 * @param {(record: Record<string, any>, txOptions: Readonly<Record<string, any>>) => Promise<T> | T} work
 * @returns {Promise<T>}
 */
async function lockOrCreate(handle, row, options, work) {
  if (!isRecord(row) || row.id == null) {
    throw new TypeError(`${handle.name}.lockOrCreate() takes (row, options, work), the row to create holding its id.`);
  }
  const locked = async (txOptions) => {
    const existing = await handle.lock(row.id, { ...txOptions, missing: "skip" });
    if (existing) {
      return existing;
    }
    await handle.createMany([row], { ...txOptions, onConflict: CREATE_IF_MISSING, returning: "none" });
    return handle.lock(row.id, txOptions);
  };
  if (options.trx) {
    return work(await locked(options), options);
  }
  for (let attempt = 1; ; attempt += 1) {
    let started = false;
    try {
      return await handle.withTransaction({ ...options, retry: false }, async (txOptions) => {
        const record = await locked(txOptions);
        started = true;
        return work(record, txOptions);
      });
    } catch (error) {
      if (started || attempt >= CREATE_RACE_ATTEMPTS || !(isDeadlockError(error) || isDuplicateEntryError(error))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * 2 ** attempt));
    }
  }
}

export { lockOrCreate };
