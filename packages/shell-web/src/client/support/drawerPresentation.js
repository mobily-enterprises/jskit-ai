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

// Material 3 navigation (a bar, a rail, a drawer) moves between destinations: with one in all, such as Home alone,
// there is nowhere to go, and the shell draws none. Each destination is in one outlet at a time (on a phone the bar's
// are not in the drawer), so the outlets' counts add up to the surface's destinations.
const MIN_NAVIGATION_DESTINATIONS = 2;

/**
 * Whether a surface has a drawer (and so a rail and a menu control): it has one when it holds a menu destination of a
 * surface with two or more in all, or its own menu. The surface identity (a workspace switcher) keeps it beside any
 * navigation, as on a phone whose destinations are all in the navigation bar; a surface with no navigation at all,
 * such as an account surface, or with Home alone, has none.
 * @param {{ menuSlot?: boolean, menuCount?: number, identityCount?: number, bottomNavigationCount?: number }} outlets
 */
function shellLayoutHasDrawer({ menuSlot = false, menuCount = 0, identityCount = 0, bottomNavigationCount = 0 } = {}) {
  const destinations = menuCount + bottomNavigationCount;
  return menuSlot ||
    (menuCount > 0 && destinations >= MIN_NAVIGATION_DESTINATIONS) ||
    (identityCount > 0 && destinations > 0);
}

/**
 * Whether a compact window shows the navigation bar: it holds a destination of a surface with two or more in all.
 * @param {{ bottomNavigationCount?: number, menuCount?: number }} outlets
 */
function shellLayoutHasNavigationBar({ bottomNavigationCount = 0, menuCount = 0 } = {}) {
  return bottomNavigationCount > 0 && bottomNavigationCount + menuCount >= MIN_NAVIGATION_DESTINATIONS;
}

export {
  DESKTOP_DRAWER_CLOSED_MODES,
  normalizeDesktopDrawerClosedMode,
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel,
  shellLayoutHasDrawer,
  shellLayoutHasNavigationBar
};
