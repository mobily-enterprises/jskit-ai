/**
 * What workspaces-web reads from the browser, each probe written once. Outside a browser, as in a test, there is no
 * window.
 */

/** The page's window; null outside a browser. */
function pageWindow() {
  return typeof window !== "undefined" ? window : null;
}

/** The page's path; empty outside a browser. */
function pagePathname() {
  return String(pageWindow()?.location?.pathname || "").trim();
}

/** The page's local storage; null outside a browser or where the browser refuses it. */
function pageLocalStorage() {
  try {
    return pageWindow()?.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Sends the page to an address.
 * @param {string} href
 * @returns {boolean} False outside a browser, where there is no page to send.
 */
function assignPageLocation(href) {
  const location = pageWindow()?.location;
  if (!location) {
    return false;
  }
  location.assign(href);
  return true;
}

/** Whether the system asks for a dark theme; false where the page cannot tell. */
function pagePrefersDark() {
  const page = pageWindow();
  // readable-check: allow method-probe - platform object: matchMedia exists only in a browser, and not in every one
  if (typeof page?.matchMedia !== "function") {
    return false;
  }
  return page.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The page's clipboard; null where the browser offers none, as on an insecure origin. */
function pageClipboard() {
  return globalThis.navigator?.clipboard || null;
}

export { assignPageLocation, pageClipboard, pageLocalStorage, pagePathname, pagePrefersDark };
