import { isExternalLinkTarget } from "@jskit-ai/kernel/shared/support/linkPath";
import { pageWindow } from "../browser.js";

/**
 * Loads an in-app page as a new document in place of the current history entry, rebuilding all client state: after
 * signing in, or switching user. The tab's trail starts again, as on a pasted link. Use router navigation for
 * everything else.
 * @param {string} target An in-app path, such as one from `usePaths().page()`.
 */
function reloadAppPage(target) {
  const path = String(target || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || isExternalLinkTarget(path)) {
    throw new TypeError(`reloadAppPage() takes an in-app path, not "${path}"; use leaveApp() for another site.`);
  }
  pageWindow()?.location.replace(path);
}

/**
 * Leaves the app for another site in the same tab, such as a payment provider's checkout. External pages never enter
 * the trail.
 * @param {string} url An absolute http(s) URL on another origin.
 */
function leaveApp(url) {
  const windowRef = pageWindow();
  const target = String(url || "").trim();
  let parsed = null;
  try {
    parsed = new URL(target);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^https?:$/u.test(parsed.protocol) || (windowRef && parsed.origin === windowRef.location.origin)) {
    throw new TypeError(`leaveApp() takes another site's http(s) URL, not "${target}"; navigate in-app pages with the router.`);
  }
  windowRef?.location.assign(parsed.href);
}

export { leaveApp, reloadAppPage };
