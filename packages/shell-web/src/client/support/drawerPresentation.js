import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const DESKTOP_DRAWER_CLOSED_MODES = Object.freeze(["rail", "hidden"]);

function normalizeDesktopDrawerClosedMode(value = "rail") {
  const normalized = String(value || "rail").trim().toLowerCase();
  return DESKTOP_DRAWER_CLOSED_MODES.includes(normalized) ? normalized : "rail";
}

/**
 * How the shell's navigation drawer presents: a modal drawer over the page (compact and medium windows), or on
 * expanded windows a standard drawer that collapses to a navigation rail (or hides, with `desktopClosedMode: "hidden"`).
 * @param {{ modal?: boolean, open?: boolean, desktopClosedMode?: string }} [options]
 */
function resolveShellDrawerPresentation({
  modal = false,
  open = false,
  desktopClosedMode = "rail"
} = {}) {
  const closedMode = normalizeDesktopDrawerClosedMode(desktopClosedMode);
  if (modal) {
    return Object.freeze({
      visible: Boolean(open),
      rail: false,
      kind: "modal",
      closedMode
    });
  }
  if (open) {
    return Object.freeze({
      visible: true,
      rail: false,
      kind: "drawer",
      closedMode
    });
  }
  if (closedMode === "hidden") {
    return Object.freeze({
      visible: false,
      rail: false,
      kind: "hidden",
      closedMode
    });
  }
  return Object.freeze({
    visible: true,
    rail: true,
    kind: "rail",
    closedMode
  });
}

function resolveShellDrawerToggleLabel({ modal = false, open = false } = {}) {
  if (modal) {
    return open ? t("jskit.shell.layout.closeNavigationMenu") : t("jskit.shell.layout.openNavigationMenu");
  }
  return open ? t("jskit.shell.layout.collapseNavigationDrawer") : t("jskit.shell.layout.expandNavigationDrawer");
}

/**
 * Whether a surface has a drawer (and so a rail and a menu control): it has one when it has menu destinations or its
 * own menu. The surface identity (a workspace switcher) keeps it only beside navigation, as on a phone whose
 * destinations are all in the navigation bar; a surface with no navigation at all, such as an account surface, has
 * none.
 * @param {{ menuSlot?: boolean, menuCount?: number, identityCount?: number, bottomNavigationCount?: number }} outlets
 */
function shellLayoutHasDrawer({ menuSlot = false, menuCount = 0, identityCount = 0, bottomNavigationCount = 0 } = {}) {
  return menuSlot || menuCount > 0 || (identityCount > 0 && bottomNavigationCount > 0);
}

export {
  DESKTOP_DRAWER_CLOSED_MODES,
  normalizeDesktopDrawerClosedMode,
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel,
  shellLayoutHasDrawer
};
