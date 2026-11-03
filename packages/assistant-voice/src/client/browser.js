/**
 * What the voice client reads from the browser, each probe written once. Outside a browser, as in a server render or a
 * test, there is no page, document, audio or crypto to reach.
 */

/**
 * The page's AudioContext constructor under either of its names; undefined where the browser has none.
 * @returns {typeof AudioContext | undefined}
 */
function audioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext;
}

/**
 * Listens to an event of the page until the returned function is called.
 * @param {string} type
 * @param {EventListener} listener
 * @returns {() => void} Stops listening.
 */
function listenToPage(type, listener) {
  const page = globalThis.window || globalThis;
  // readable-check: allow optional-call - platform object: outside a browser the global object takes no event listeners
  page.addEventListener?.(type, listener);
  return () => {
    // readable-check: allow optional-call - platform object: outside a browser the global object takes no event listeners
    page.removeEventListener?.(type, listener);
  };
}

/**
 * Listens to an event of the document until the returned function is called.
 * @param {string} type
 * @param {EventListener} listener
 * @returns {() => void} Stops listening.
 */
function listenToDocument(type, listener) {
  // readable-check: allow optional-call - platform object: outside a browser there is no document to listen to
  globalThis.document?.addEventListener?.(type, listener);
  return () => {
    // readable-check: allow optional-call - platform object: outside a browser there is no document to listen to
    globalThis.document?.removeEventListener?.(type, listener);
  };
}

/**
 * Whether the page is visible; outside a browser it counts as visible.
 * @returns {boolean}
 */
function pageVisible() {
  return globalThis.document?.visibilityState !== "hidden";
}

/**
 * A unique id for one listening or speaking turn.
 * @param {string} [prefix]
 * @returns {string}
 */
function createVoiceTurnId(prefix = "turn") {
  // readable-check: allow optional-call - platform object: a page outside a secure context has no crypto.randomUUID, so the id falls back to the clock and randomness
  const id = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export {
  audioContextConstructor,
  createVoiceTurnId,
  listenToDocument,
  listenToPage,
  pageVisible
};
