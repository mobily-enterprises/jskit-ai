import { createTextError } from "./i18n.js";

// What this package reads from the browser, written once. Outside a browser, as in a test, there is no window.

/** The page's location outside a browser: it has no origin and refuses to navigate. */
const NO_PAGE_LOCATION = Object.freeze({
  origin: "",
  assign() {
    throw createTextError("jskit.mobile.oauth.browserUnavailable");
  }
});

/**
 * The page's location, or NO_PAGE_LOCATION outside a browser.
 * @returns {import("./types.js").PageLocation}
 */
function pageLocation() {
  return typeof window === "object" && window.location ? window.location : NO_PAGE_LOCATION;
}

export { pageLocation };
