import { AssertionError, deepStrictEqual } from "node:assert";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// The other owner's rows are read back by id, this many ids per read.
const IDS_PER_READ = 1000;

// The ids each handle's table holds, read through the system context in one statement per table however many rows
// it has (queryAll would refuse a table past its row limit).
async function idsOf(handles, systemContext) {
  const ids = new Map();
  for (const handle of handles) {
    const { query } = await handle.scopedQuery({}, { context: systemContext });
    ids.set(handle, new Set((await query.pluck(handle.column("id"))).map(String)));
  }
  return ids;
}

// Every column of the handle's table, as its scoped query names the table.
function everyColumn(handle) {
  const id = handle.column("id");
  return `${id.slice(0, id.length - handle.column("id", "").length - 1)}.*`;
}

// The rows with these ids of each handle's table, read through the system context, by `${resource}:${id}`. They are
// the stored rows, not records, so a hidden or defaultExclude field, or a column outside the schema, is compared too.
async function rowsOf(idsByHandle, systemContext) {
  const rows = new Map();
  for (const [handle, ids] of idsByHandle) {
    const list = [...ids];
    for (let start = 0; start < list.length; start += IDS_PER_READ) {
      const { query } = await handle.scopedQuery({ filters: { id: list.slice(start, start + IDS_PER_READ) } }, { context: systemContext });
      for (const { __id: id, ...row } of await query.select({ __id: handle.column("id") }, everyColumn(handle))) {
        rows.set(`${handle.name}:${id}`, row);
      }
    }
  }
  return rows;
}

/**
 * Fails when a path reaches another owner's rows. It seeds owner A and runs the
 * path as A; then it seeds owner B and runs the path as A again. It fails when
 * the path removed or changed a row seeded for B, and when its second answer
 * differs from its first, so it catches a report that sums, counts or joins B's
 * rows, not only one that returns them. B's rows are read by id through the
 * system context, from the handles of the tables the path touches, as stored:
 * every column, hidden and defaultExclude fields included. The path
 * runs twice, so it answers the same for the same rows: a write answers what
 * repeats, such as the ids it changed or each refusal, not a fresh id or time.
 * @template T
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The test's environment, such as `process.env`.
 * @param {ReadonlyArray<import("../server/types.js").ResourceHandle>} options.handles
 * @param {object} options.systemContext A system context, for reading every owner's rows.
 * @param {[T, T]} options.owners What seed and run receive for owners A and B, such as `{ context }` of each.
 * @param {(owner: T) => unknown} options.seed Seeds one owner's rows.
 * @param {(owner: T) => unknown} options.run The path, run as owner A.
 * @returns {Promise<unknown>} The path's answer.
 */
async function expectScoped({ environment, handles, systemContext, owners, seed, run }) {
  requireTestDatabase(environment);
  if (!Array.isArray(handles) || handles.length < 1) {
    throw new TypeError("expectScoped needs the handles of the tables the path touches.");
  }
  if (!Array.isArray(owners) || owners.length !== 2) {
    throw new TypeError("expectScoped needs two owners, [ownerA, ownerB].");
  }
  // readable-check: allow method-probe - input validation: seed and run are the caller's own functions
  if (typeof seed !== "function" || typeof run !== "function") {
    throw new TypeError("expectScoped requires seed(owner) and run(owner) functions.");
  }
  const [ownerA, ownerB] = owners;
  await seed(ownerA);
  const alone = await run(ownerA);

  const before = await idsOf(handles, systemContext);
  await seed(ownerB);
  const added = new Map();
  for (const [handle, ids] of await idsOf(handles, systemContext)) {
    added.set(handle, new Set([...ids].filter((id) => !before.get(handle).has(id))));
  }
  const otherRows = await rowsOf(added, systemContext);
  if (otherRows.size < 1) {
    throw new TypeError("expectScoped: seeding owner B added no rows to the handles' tables, so there is nothing to protect.");
  }
  const result = await run(ownerA);

  const after = await rowsOf(added, systemContext);
  for (const [key, row] of otherRows) {
    if (!after.has(key)) {
      throw new AssertionError({ message: `The path removed ${key}, a row of the other owner.` });
    }
    try {
      deepStrictEqual(after.get(key), row);
    } catch {
      throw new AssertionError({ message: `The path changed ${key}, a row of the other owner.`, actual: after.get(key), expected: row });
    }
  }
  try {
    deepStrictEqual(result, alone);
  } catch {
    throw new AssertionError({
      message: "The path answered differently once the other owner's rows were seeded, so it reads them.",
      actual: result,
      expected: alone
    });
  }
  return result;
}

export { expectScoped };
