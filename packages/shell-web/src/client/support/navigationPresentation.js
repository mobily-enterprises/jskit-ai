/** How navigation items inside it present: "rail", "drawer", the navigation "bar" or, outside the shell's navigation, "list". */
const SHELL_NAVIGATION_PRESENTATION_KEY = "jskit.shell-web.navigation.presentation";
/** Navigation items outside the shell's drawer and rail, such as a settings section's own menu, present as a list. */
const NO_SHELL_NAVIGATION_PRESENTATION = Object.freeze({ value: "list" });

/** The page actions slot in the shell's app bar, which ShellPageActions renders into. */
const SHELL_PAGE_ACTIONS_TARGET_KEY = "jskit.shell-web.layout.page-actions-target";
const SHELL_PAGE_ACTIONS_ID = "jskit-shell-page-actions";
/** A page outside a ShellLayout has no app bar, so its page actions render in place. */
const NO_SHELL_PAGE_ACTIONS_TARGET = "";

/** Vuetify's icon options, which hold the theme's aliases (Vuetify provides them under this global symbol). */
const VUETIFY_ICONS_KEY = Symbol.for("vuetify:icons");
const NO_VUETIFY_ICONS = Object.freeze({ aliases: Object.freeze({}) });

/**
 * The filled form of a navigation icon alias for the active destination: Material 3 shows the active destination's
 * icon filled. `$home` becomes `$homeFilled` when the theme defines it; any other icon stays as it is.
 * @param {string} icon
 * @param {Record<string, unknown> | undefined} aliases The Vuetify icon aliases.
 */
function filledIconAlias(icon, aliases) {
  const name = String(icon || "");
  if (!name.startsWith("$") || !aliases) {
    return name;
  }
  const filled = `${name.slice(1)}Filled`;
  return Object.hasOwn(aliases, filled) ? `$${filled}` : name;
}

export {
  NO_SHELL_NAVIGATION_PRESENTATION,
  NO_SHELL_PAGE_ACTIONS_TARGET,
  NO_VUETIFY_ICONS,
  SHELL_NAVIGATION_PRESENTATION_KEY,
  SHELL_PAGE_ACTIONS_ID,
  SHELL_PAGE_ACTIONS_TARGET_KEY,
  VUETIFY_ICONS_KEY,
  filledIconAlias
};
