import { deleteById, optionalDateTime, readDateTime, replaceById, requiredDateTime, text } from "./tableRecords.js";

// The ids one read binds: far under PostgreSQL's 65,535 parameters, and one page of the runtime's every-row reads.
const IDS_PER_READ = 1000;

function mapSecondFactor(record) {
  if (!record) {
    return null;
  }
  return {
    userId: text(record.id),
    secretSealed: text(record.secretSealed),
    confirmedAt: readDateTime(record.confirmedAt),
    lastUsedStep: Number(record.lastUsedStep || 0),
    recoveryCodes: record.recoveryCodeHashes ? String(record.recoveryCodeHashes).split(",") : [],
    failures: Number(record.failures || 0),
    lastFailedAt: readDateTime(record.lastFailedAt),
    lockedUntil: readDateTime(record.lockedUntil),
    createdAt: readDateTime(record.createdAt),
    updatedAt: readDateTime(record.updatedAt)
  };
}

function secondFactorRecord(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    secretSealed: text(input.secretSealed),
    confirmedAt: optionalDateTime(input.confirmedAt),
    lastUsedStep: Number(input.lastUsedStep || 0),
    recoveryCodeHashes: (input.recoveryCodes || []).join(","),
    failures: Number(input.failures || 0),
    lastFailedAt: optionalDateTime(input.lastFailedAt),
    lockedUntil: optionalDateTime(input.lockedUntil),
    createdAt,
    updatedAt: requiredDateTime(input.updatedAt, createdAt)
  };
}

/**
 * Local auth's second factors, one per account.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} secondFactors
 * @param {object} options
 */
function secondFactorRecords(secondFactors, options) {
  return Object.freeze({
    // Locks the account's record until the transaction ends, so concurrent codes are checked one after another.
    async find(userId) {
      const id = text(userId);
      return id ? mapSecondFactor(await secondFactors.lock(id, { ...options, missing: "skip" })) : null;
    },
    // The accounts' records, however many: one read per 1,000 distinct ids.
    async findMany(userIds) {
      const ids = [...new Set(userIds.map(text).filter(Boolean))];
      const records = [];
      for (let start = 0; start < ids.length; start += IDS_PER_READ) {
        records.push(...await secondFactors.queryAll({ filters: { id: ids.slice(start, start + IDS_PER_READ) } }, options));
      }
      return records.map(mapSecondFactor);
    },
    async save(input) {
      const userId = text(input.userId);
      const record = secondFactorRecord(input);
      await replaceById(secondFactors, userId, record, options);
      return mapSecondFactor({ id: userId, ...record });
    },
    async delete(userId) {
      return deleteById(secondFactors, userId, options);
    }
  });
}

export { secondFactorRecords };
