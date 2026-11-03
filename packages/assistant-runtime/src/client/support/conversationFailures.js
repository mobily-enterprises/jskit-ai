import { useJskitText } from "../i18n.js";

const { serverMessage } = useJskitText();

/**
 * Whether a conversation failure means the viewer lost access to it.
 * @param {{ status?: number, statusCode?: number }} error
 */
function isAccessDenied(error) {
  return [401, 403].includes(Number(error.status || error.statusCode));
}

/**
 * A failure in the active language when its code or messageCode is JSKIT's English; otherwise its message as sent.
 * @param {any} failure
 * @param {string} [fallback] The text for a failure without a message.
 */
function failureMessage(failure, fallback = "") {
  return failure?.message ? serverMessage(failure) : fallback;
}

/**
 * A refused result's error text, read like a failure's message.
 * @param {any} result
 */
function resultError(result) {
  return failureMessage({ ...result, message: result?.error });
}

export { failureMessage, isAccessDenied, resultError };
