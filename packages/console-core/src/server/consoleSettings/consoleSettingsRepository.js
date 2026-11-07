import { normalizeDbRecordId, toIsoString } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

// The one console settings record's id.
const SINGLETON_ID = "1";

function mapSingletonRecord(record) {
  if (!record) {
    throw new Error("console_settings singleton row is missing.");
  }

  const ownerUserId = normalizeDbRecordId(record.ownerUserId, { fallback: null });
  return {
    id: normalizeDbRecordId(record.id, { fallback: SINGLETON_ID }),
    ownerUserId,
    settings: {},
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt)
  };
}

/**
 * The `console.settings` capability: the one console_settings record, through the console feature's handle. Each
 * call takes the call's options last and runs in their transaction, or on its own.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.consoleSettings
 */
function createRepository({ consoleSettings }) {
  /**
   * Runs work in one transaction, or in the options' transaction, handing it the options its calls pass on. Failed
   * work rejects with the work's own error.
   * @template T
   * @param {object} options
   * @param {(txOptions: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function withTransaction(options, work) {
    let workFailure = null;
    try {
      return await consoleSettings.withTransaction(options, async (txOptions) => {
        workFailure = null;
        try {
          return await work(txOptions);
        } catch (error) {
          workFailure = { error };
          throw error;
        }
      });
    } catch (error) {
      throw workFailure ? workFailure.error : error;
    }
  }

  async function getSingleton(options = {}) {
    return mapSingletonRecord(await consoleSettings.get(SINGLETON_ID, {}, options));
  }

  async function ensureOwnerUserId(userId, options = {}) {
    const candidateOwnerUserId = normalizeRecordId(userId, { fallback: null });
    if (!candidateOwnerUserId) {
      throw new TypeError("consoleSettingsRepository.ensureOwnerUserId requires a positive user id.");
    }

    const current = await getSingleton(options);
    if (current.ownerUserId) {
      return current.ownerUserId;
    }

    // Only while the record has no owner: of two first owners at once, the first to lock it wins.
    await consoleSettings.patch(SINGLETON_ID, {
      ownerUserId: candidateOwnerUserId,
      updatedAt: new Date().toISOString()
    }, { ...options, onlyIf: { ownerUserId: null }, returning: "none" });

    const reloaded = await getSingleton(options);
    if (!reloaded.ownerUserId) {
      throw new Error("console_settings owner_user_id could not be resolved.");
    }

    return reloaded.ownerUserId;
  }

  // Touches the record's updatedAt; the settings have no columns.
  async function updateSingleton(options = {}) {
    await getSingleton(options);
    return mapSingletonRecord(await consoleSettings.patch(SINGLETON_ID, { updatedAt: new Date().toISOString() }, options));
  }

  return Object.freeze({
    withTransaction,
    getSingleton,
    ensureOwnerUserId,
    updateSingleton
  });
}

export { createRepository };
