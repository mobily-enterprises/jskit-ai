// JSKIT's Vite plugin names every built HTML page's build in this meta tag, so
// the build a tab runs and the build its server serves now can be compared
// without another request. Vite's development server pages have none.
const CLIENT_BUILD_META_NAME = "jskit-client-build";
const CLIENT_BUILD_META_PATTERN = new RegExp(`<meta name="${CLIENT_BUILD_META_NAME}" content="([0-9a-f]+)"`, "u");

function clientBuildIdFromHtml(html = "") {
  return CLIENT_BUILD_META_PATTERN.exec(String(html || ""))?.[1] || "";
}

// The build of the page this tab loaded; "" in development and outside a browser.
function pageClientBuildId(documentObject = globalThis.document) {
  const meta = documentObject?.querySelector?.(`meta[name="${CLIENT_BUILD_META_NAME}"]`);
  return String(meta?.getAttribute?.("content") || "").trim();
}

export {
  CLIENT_BUILD_META_NAME,
  clientBuildIdFromHtml,
  pageClientBuildId
};
