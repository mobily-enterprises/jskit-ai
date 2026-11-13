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

/** The page's clipboard; null outside a browser, and on a page the browser does not trust with it (one not on HTTPS). */
function pageClipboard() {
  return pageWindow()?.navigator.clipboard || null;
}

/** The element that has the page's focus; null outside a browser. */
function pageActiveElement() {
  return pageDocument()?.activeElement || null;
}

/**
 * Has the browser save `text` as a file named `fileName`; does nothing outside a browser.
 * @param {string} fileName
 * @param {string} text
 */
function saveTextFile(fileName, text) {
  const window = pageWindow();
  const document = pageDocument();
  if (!window || !document) {
    return;
  }
  const url = window.URL.createObjectURL(new window.Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has started the download, which reads the file first.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
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
  pageActiveElement,
  pageClipboard,
  pageDocument,
  pageLocation,
  pageWindow,
  replacePage,
  saveTextFile
};
