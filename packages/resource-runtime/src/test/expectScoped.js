import { AssertionError, deepStrictEqual } from "node:assert";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// Each handle's rows, read through the system context, by `${resource}:${id}`.
async function snapshot(handles, systemContext) {
  const rows = new Map();
  for (const handle of handles) {
    for (const record of await handle.queryAll({}, { context: systemContext })) {
      rows.set(`${handle.name}:${record.id}`, record);
    }
  }
  return rows;
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean", "bigint"].includes(typeof value) || value instanceof Date;
}

function sameValue(left, right) {
  return left instanceof Date || right instanceof Date ? String(new Date(left)) === String(new Date(right)) : String(left) === String(right);
}

// A record in the result that is one of the other owner's rows: the same id and every scalar field the two share equal.
function leakedRow(value, otherRows, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (!Array.isArray(value) && value.id != null) {
    for (const [key, row] of otherRows) {
      if (String(row.id) !== String(value.id)) {
        continue;
      }
      const shared = Object.keys(value).filter((field) => field !== "id" && Object.hasOwn(row, field) && isScalar(value[field]) && isScalar(row[field]));
      if (shared.length > 0 && shared.every((field) => sameValue(value[field], row[field]))) {
        return key;
      }
    }
  }
  for (const nested of Object.values(value)) {
    const found = leakedRow(nested, otherRows, seen);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Fails when a path reaches another owner's rows. It seeds owner B, then owner
 * A, runs the path as A, and asserts that no row seeded for B appears in the
 * result and that every row B had is unchanged afterwards. Rows are read through
 * the system context, from the handles of the tables the path touches.
 * @template T
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The test's environment, such as `process.env`.
 * @param {ReadonlyArray<import("../server/types.js").ResourceHandle>} options.handles
 * @param {object} options.systemContext A system context, for reading every owner's rows.
 * @param {[T, T]} options.owners What seed and run receive for owners A and B, such as `{ context }` of each.
 * @param {(owner: T) => unknown} options.seed Seeds one owner's rows.
 * @param {(owner: T) => unknown} options.run The path, run as owner A.
 * @returns {Promise<unknown>} The path's result.
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
  const before = await snapshot(handles, systemContext);
  await seed(ownerB);
  const otherRows = new Map([...await snapshot(handles, systemContext)].filter(([key]) => !before.has(key)));
  if (otherRows.size < 1) {
    throw new TypeError("expectScoped: seeding owner B added no rows to the handles' tables, so there is nothing to protect.");
  }
  await seed(ownerA);
  const result = await run(ownerA);

  const leaked = leakedRow(result, otherRows);
  if (leaked) {
    throw new AssertionError({ message: `The path's result holds ${leaked}, a row of the other owner.` });
  }
  const after = await snapshot(handles, systemContext);
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
  return result;
}

export { expectScoped };
