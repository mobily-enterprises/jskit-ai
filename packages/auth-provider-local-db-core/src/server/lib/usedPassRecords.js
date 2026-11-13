import { findById, requiredDateTime, text } from "./tableRecords.js";

/**
 * Local auth's used one-time passes, by the hash of each pass's id. Two first uses of one pass at once, on one server
 * or two, both find no row and both create it: the later fails with a duplicate entry, its transaction rolls back, and
 * the backend runs it again, which finds the row and answers false.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} usedPasses
 * @param {object} options
 */
function usedPassRecords(usedPasses, options) {
  return Object.freeze({
    async use(input) {
      const id = text(input.id);
      if (await findById(usedPasses, id, options)) {
        return false;
      }
      await usedPasses.create(
        { id, expiresAt: requiredDateTime(input.expiresAt), createdAt: requiredDateTime() },
        { ...options, returning: "none" }
      );
      return true;
    },
    async deleteExpired(now) {
      return usedPasses.deleteWhere({ expiresAtOrBefore: requiredDateTime(now) }, { ...options, returning: "count" });
    }
  });
}

export { usedPassRecords };
