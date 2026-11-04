/**
 * What the client runtime reads from the browser, each probe written once. Outside a browser, as in a test, there is
 * no window.
 */

/** The page's window; null outside a browser. */
function pageWindow() {
  return typeof window !== "undefined" ? window : null;
}

/** The page's path, for diagnostics; empty outside a browser. */
function pagePathname() {
  return String(pageWindow()?.location?.pathname || "");
}

export { pagePathname, pageWindow };
