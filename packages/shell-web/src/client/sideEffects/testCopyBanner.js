import {
  SIDE_EFFECTS_SIMULATE,
  pageSideEffectsMode
} from "@jskit-ai/kernel/shared/support/sideEffects";
import { pageDocument } from "../browser.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const TEST_COPY_BANNER_ID = "jskit-test-copy-banner";

// A small tab hanging from the top edge, above everything, that never takes a click or a tap: it marks the page
// without covering a control the person needs. Amber with near-black text reads the same in light and dark themes.
const TEST_COPY_BANNER_STYLE = Object.freeze({
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
 * Shows the "Test copy" banner when the page says its server simulates side effects (SIDE_EFFECTS is not `live`),
 * so everyone using a test copy knows no real email, message or payment goes out. It needs no application code: the
 * shell adds it to the page's body, outside the application's own layout. A live page, or a page that names no
 * setting, gets none. Returns the function that removes it.
 * @param {object} [options]
 * @param {Document | null} [options.documentObject]
 * @param {"live" | "simulate" | ""} [options.mode] The page's setting; read from its meta tag when omitted.
 * @returns {() => void}
 */
function installTestCopyBanner({ documentObject = pageDocument(), mode = pageSideEffectsMode(documentObject) } = {}) {
  if (mode !== SIDE_EFFECTS_SIMULATE || !documentObject?.body || documentObject.getElementById(TEST_COPY_BANNER_ID)) {
    return removeNothing;
  }
  const banner = documentObject.createElement("div");
  banner.id = TEST_COPY_BANNER_ID;
  banner.setAttribute("data-testid", TEST_COPY_BANNER_ID);
  // A note read by its visible text, with the full sentence as its description. A label would make it a labelled
  // element, which a browser test's field lookup such as `getByLabel("Email")` would also find.
  banner.setAttribute("role", "note");
  banner.setAttribute("aria-description", t("jskit.shell.sideEffects.testCopyDescription"));
  banner.textContent = t("jskit.shell.sideEffects.testCopy");
  // Through the style object, not a style attribute, so a strict content policy without inline styles allows it.
  Object.assign(banner.style, TEST_COPY_BANNER_STYLE);
  documentObject.body.append(banner);
  return () => banner.remove();
}

/**
 * The shell's banner runtime: `install()` shows the banner as the shell boots, `dispose()` removes it as it shuts
 * down.
 * @param {Parameters<typeof installTestCopyBanner>[0]} [options]
 */
function createTestCopyBannerRuntime(options) {
  let remove = removeNothing;

  function install() {
    remove();
    remove = installTestCopyBanner(options);
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

export { TEST_COPY_BANNER_ID, createTestCopyBannerRuntime, installTestCopyBanner };
