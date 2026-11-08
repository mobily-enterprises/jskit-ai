import { normalizeDbRecordId } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";

// The ids one read binds: far under PostgreSQL's 65,535 parameters, and one page of the runtime's every-row reads
// (1,000 rows), so each read is one statement.
const IDS_PER_READ = 1000;

// Canonical ids (digits, no leading zero) in numeric order: shorter first, then by their digits.
function byNumericId(left, right) {
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * The records of a users table keyed by user id with these ids, all of them however many, sorted by id: one read per
 * 1,000 distinct ids, each joining the caller's transaction and seeing what `query` sees for the caller's context. An
 * id named twice answers its record once; an id naming no record the caller can see, or that is no id, is left out.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {string} method The caller's name, for its error.
 * @param {readonly unknown[]} userIds
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function queryAllByIds(handle, method, userIds, options) {
  if (!Array.isArray(userIds)) {
    throw new TypeError(`${method} takes an array of user ids.`);
  }
  const ids = [...new Set(userIds.map((id) => normalizeDbRecordId(id, { fallback: null })).filter(Boolean))].sort(byNumericId);
  const records = [];
  for (let start = 0; start < ids.length; start += IDS_PER_READ) {
    records.push(...await handle.queryAll(
      { filters: { id: ids.slice(start, start + IDS_PER_READ) }, sort: ["id"] },
      passedOn(options)
    ));
  }
  return records;
}

export { queryAllByIds };
