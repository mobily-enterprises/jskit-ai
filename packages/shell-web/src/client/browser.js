/**
 * What shell-web reads from the browser, each probe written once. Outside a browser, as in a test, there is no window
 * and no document.
 */

/** The page's window; null outside a browser. */
function pageWindow() {
  return typeof window !== "undefined" ? window : null;
}

/** The page's document; null outside a browser. */
function pageDocument() {
  return typeof document !== "undefined" ? document : null;
}

/** The page's path; empty outside a browser. */
function pagePathname() {
  return String(pageWindow()?.location?.pathname || "").trim();
}

/** The page's origin; empty outside a browser. */
function pageOrigin() {
  return String(pageWindow()?.location?.origin || "");
}

/** The page's title; empty outside a browser. */
function pageTitle() {
  return String(pageDocument()?.title || "");
}

/** The viewport's width; 0 outside a browser. */
function pageViewportWidth() {
  return Number(pageWindow()?.innerWidth || 0);
}

/** The page's local storage; null outside a browser. */
function pageStorage() {
  return pageWindow()?.localStorage || null;
}

/** The nearest element matching the selectors, from an event's target. */
function closestElement(target, selectors) {
  // readable-check: allow optional-call - platform object: an event's target may be the window or a text node, which have no closest()
  return target?.closest?.(selectors) || null;
}

export {
  closestElement,
  pageDocument,
  pageOrigin,
  pagePathname,
  pageStorage,
  pageTitle,
  pageViewportWidth,
  pageWindow
};
