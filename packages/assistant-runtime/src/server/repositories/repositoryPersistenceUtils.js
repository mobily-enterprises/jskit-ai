import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { parseJsonObject } from "@jskit-ai/assistant-core/shared";

/** @param {unknown} value */
function normalizeInputRecordId(value) {
  return normalizeRecordId(value, { fallback: null });
}

/** @param {unknown} value */
function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

/** @param {unknown} value */
function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

/**
 * A date-time a repository writes: the caller's value as ISO text, or now.
 * @param {unknown} [value]
 */
function toWrittenDateTime(value = null) {
  return (value ? new Date(/** @type {string | number | Date} */ (value)) : new Date()).toISOString();
}

/**
 * Runs `work` in the caller's transaction (`options`), or in one the handle
 * opens. json-rest-api reports a failed transaction as a RestApiWriteError
 * whose cause is what the work threw; callers see the work's own error, as
 * they did before the tables moved onto resources.
 * @template T
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {Record<string, unknown>} options
 * @param {(txOptions: Readonly<Record<string, any>>) => Promise<T> | T} work
 * @param {{ retry?: boolean }} [settings]
 * @returns {Promise<T>}
 */
async function runInHandleTransaction(handle, options, work, settings) {
  let failure;
  try {
    return await handle.withTransaction(options, async (txOptions) => {
      try {
        return await work(txOptions);
      } catch (error) {
        failure = error;
        throw error;
      }
    }, settings);
  } catch (error) {
    throw failure !== undefined && error?.cause === failure ? failure : error;
  }
}

export {
  normalizeInputRecordId,
  parseJsonObject,
  runInHandleTransaction,
  stringifyJsonObject,
  toIso,
  toWrittenDateTime
};
