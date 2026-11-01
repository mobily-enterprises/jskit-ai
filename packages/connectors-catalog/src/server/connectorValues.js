// The value checks several providers share when they validate a provider's response or settings.

/**
 * A safe integer that is zero or more, such as a count or a version number.
 * @param {unknown} value
 */
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * A non-empty string.
 * @param {unknown} value
 */
const isText = (value) => typeof value === "string" && value.length > 0;

/**
 * A response record that carries a string `id`.
 * @param {any} value
 */
const hasStringId = (value) => typeof value?.id === "string";

/**
 * A response whose `data` is a list.
 * @param {any} result
 */
const hasDataList = (result) => Array.isArray(result?.data);

/**
 * The origin of the account URL a connection's settings hold.
 * @param {{ accountUrl: string }} settings
 */
const accountOrigin = (settings) => new URL(settings.accountUrl).origin;

export { isCount, isText, hasStringId, hasDataList, accountOrigin };
