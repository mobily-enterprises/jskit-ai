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
  const page = globalThis.window;
  // readable-check: allow optional-call - platform object: outside a browser there is no window to listen to
  page?.addEventListener?.(type, listener);
  return () => {
    // readable-check: allow optional-call - platform object: outside a browser there is no window to listen to
    page?.removeEventListener?.(type, listener);
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
 * Reads a media query and follows its changes until `stop()` is called.
 * @param {string} query
 * @param {(event: MediaQueryListEvent) => void} listener
 * @returns {{ matches: boolean, stop: () => void }}
 */
function followMediaQuery(query, listener) {
  const list = window.matchMedia(query);
  const matches = list.matches;
  // readable-check: allow optional-call - platform object: an older MediaQueryList has no addEventListener, so its first reading stays
  list.addEventListener?.("change", listener);
  return {
    matches,
    stop() {
      // readable-check: allow optional-call - platform object: an older MediaQueryList has no addEventListener, so its first reading stays
      list.removeEventListener?.("change", listener);
    }
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
 * A unique id for one listening or speaking turn. Voice runs only in a secure context, which always has crypto.randomUUID.
 * @param {"listen" | "speak"} prefix
 * @returns {string}
 */
function createVoiceTurnId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export {
  audioContextConstructor,
  createVoiceTurnId,
  followMediaQuery,
  listenToDocument,
  listenToPage,
  pageVisible
};
