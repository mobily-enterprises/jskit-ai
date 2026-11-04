/**
 * What auth-web reads from the browser, each probe written once. Outside a browser, as in a test, there is no window
 * and no document.
 */

/** The page's window; null outside a browser. */
function pageWindow() {
  return typeof window === "undefined" ? null : window;
}

/** The page's document; null outside a browser. */
function pageDocument() {
  return typeof document === "undefined" ? null : document;
}

/** The page's location; null outside a browser. */
function pageLocation() {
  return pageWindow()?.location || null;
}

/**
 * Replaces the page with the one at `path`; does nothing outside a browser.
 * @param {string} path
 */
function replacePage(path) {
  const location = pageLocation();
  if (location) {
    location.replace(path);
  }
}

export {
  pageDocument,
  pageLocation,
  pageWindow,
  replacePage
};
