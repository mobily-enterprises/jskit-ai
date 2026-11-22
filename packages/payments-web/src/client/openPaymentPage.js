/**
 * Whether the page runs inside a frame: a Preview pane or another page embedding the application. Stripe Checkout
 * refuses to load framed, so a framed page opens it in a tab of its own. A parent on another origin can make the
 * comparison throw, which only a framed page does.
 * @param {Window} page
 */
function isFramed(page) {
  try {
    return page.self !== page.top;
  } catch {
    return true;
  }
}

/**
 * Opens a provider's payment page, the Checkout URL the application's server returned, where the page can show it.
 * Unframed, this tab goes there ("redirected"). Framed, a new tab opens it ("opened"), or the browser refuses the new
 * tab ("blocked"): show a control that calls this again, since a click lets the tab open. The new tab gets no
 * "noopener" feature, with which window.open answers null even when the tab opened, so a blocked tab could not be
 * told apart; its opener is cut by hand instead.
 * @param {string} url
 * @param {Window} [page] The page's window; the browser's own by default.
 * @returns {"redirected" | "opened" | "blocked"}
 */
function openPaymentPage(url, page = globalThis.window) {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new TypeError("Open only the http(s) payment page URL the application's server returned.");
  }
  if (!isFramed(page)) {
    page.location.assign(target.href);
    return "redirected";
  }
  const opened = page.open(target.href, "_blank");
  if (!opened) return "blocked";
  try {
    opened.opener = null;
  } catch {
    // A browser that keeps the opener read-only still opened the tab.
  }
  return "opened";
}

export { openPaymentPage };
