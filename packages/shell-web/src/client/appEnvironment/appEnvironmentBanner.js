import { pageAppEnvironment } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { pageDocument } from "../browser.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const APP_ENVIRONMENT_BANNER_ID = "jskit-app-environment-banner";
// Every environment but production names itself on the page.
const BANNERED_ENVIRONMENTS = Object.freeze(["development", "test", "staging"]);
// Each bannered environment's label and description: `<prefix><environment>` and `<prefix><environment>Description`.
const BANNER_TEXT_PREFIX = "jskit.shell.appEnvironment.";

// A small tab hanging from the top edge, above everything, that never takes a click or a tap: it marks the page
// without covering a control the person needs. Amber with near-black text reads the same in light and dark themes.
const APP_ENVIRONMENT_BANNER_STYLE = Object.freeze({
  position: "fixed",
  top: "env(safe-area-inset-top, 0px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: "2147483000",
  pointerEvents: "none",
  userSelect: "none",
  padding: "2px 12px 3px",
  borderRadius: "0 0 8px 8px",
  background: "#ffb300",
  color: "#1f1300",
  font: "600 12px/16px system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)"
});

function removeNothing() {}

/**
 * Shows the page's environment, "Development", "Test" or "Staging", from the page's APP_ENV meta tag, so everyone
 * using a copy that is not production knows what it sends. It needs no application code: the shell adds it to the
 * page's body, outside the application's own layout. A production page, or a page that names no environment, gets
 * none. Returns the function that removes it.
 * @param {object} [options]
 * @param {Document | null} [options.documentObject]
 * @param {"development" | "test" | "staging" | "production" | ""} [options.environment] The page's environment; read
 *   from its meta tag when omitted.
 * @returns {() => void}
 */
function installAppEnvironmentBanner({ documentObject = pageDocument(), environment = pageAppEnvironment(documentObject) } = {}) {
  if (!BANNERED_ENVIRONMENTS.includes(environment) || !documentObject?.body ||
    documentObject.getElementById(APP_ENVIRONMENT_BANNER_ID)) {
    return removeNothing;
  }
  const banner = documentObject.createElement("div");
  banner.id = APP_ENVIRONMENT_BANNER_ID;
  banner.setAttribute("data-testid", APP_ENVIRONMENT_BANNER_ID);
  // A note read by its visible text, with the full sentence as its description. A label would make it a labelled
  // element, which a browser test's field lookup such as `getByLabel("Email")` would also find.
  banner.setAttribute("role", "note");
  banner.setAttribute("aria-description", t(`${BANNER_TEXT_PREFIX}${environment}Description`));
  banner.textContent = t(`${BANNER_TEXT_PREFIX}${environment}`);
  // Through the style object, not a style attribute, so a strict content policy without inline styles allows it.
  Object.assign(banner.style, APP_ENVIRONMENT_BANNER_STYLE);
  documentObject.body.append(banner);
  return () => banner.remove();
}

/**
 * The shell's banner runtime: `install()` shows the banner as the shell boots, `dispose()` removes it as it shuts
 * down.
 * @param {Parameters<typeof installAppEnvironmentBanner>[0]} [options]
 */
function createAppEnvironmentBannerRuntime(options) {
  let remove = removeNothing;

  function install() {
    remove();
    remove = installAppEnvironmentBanner(options);
  }

  function dispose() {
    remove();
    remove = removeNothing;
  }

  return Object.freeze({
    install,
    dispose
  });
}

export { APP_ENVIRONMENT_BANNER_ID, createAppEnvironmentBannerRuntime, installAppEnvironmentBanner };
