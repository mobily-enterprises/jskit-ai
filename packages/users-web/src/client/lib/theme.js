import { ThemeSymbol } from "vuetify/lib/composables/theme.js";

const THEME_PREFERENCE_LIGHT = "light";
const THEME_PREFERENCE_DARK = "dark";
const THEME_PREFERENCE_SYSTEM = "system";

function normalizeThemePreference(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === THEME_PREFERENCE_LIGHT || normalized === THEME_PREFERENCE_DARK) {
    return normalized;
  }
  return THEME_PREFERENCE_SYSTEM;
}

/** The page's window; null outside a browser. */
function pageWindow() {
  return typeof window === "undefined" ? null : window;
}

/** Whether the system asks for a dark theme; false where it cannot say. */
function systemPrefersDark() {
  const page = pageWindow();
  // readable-check: allow method-probe - platform object: matchMedia exists only in a browser
  return typeof page?.matchMedia === "function" && page.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveSystemThemeName({ prefersDark = systemPrefersDark() } = {}) {
  return prefersDark ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
}

function resolveThemeNameForPreference(themePreference, options = {}) {
  const normalizedPreference = normalizeThemePreference(themePreference);
  if (normalizedPreference === THEME_PREFERENCE_DARK) {
    return THEME_PREFERENCE_DARK;
  }
  if (normalizedPreference === THEME_PREFERENCE_LIGHT) {
    return THEME_PREFERENCE_LIGHT;
  }

  return resolveSystemThemeName(options);
}

function resolveThemePreferenceStorage(options = {}) {
  const customStorage = options && typeof options === "object" ? options.storage : null;
  if (customStorage && typeof customStorage === "object") {
    return customStorage;
  }

  try {
    return pageWindow()?.localStorage || null;
  } catch {
    return null;
  }
}

function readPersistedThemePreference(options = {}) {
  const storage = resolveThemePreferenceStorage(options);
  if (!storage) {
    return THEME_PREFERENCE_SYSTEM;
  }

  try {
    return normalizeThemePreference(storage.getItem("jskit.themePreference"));
  } catch {
    return THEME_PREFERENCE_SYSTEM;
  }
}

function persistThemePreference(themePreference, options = {}) {
  const storage = resolveThemePreferenceStorage(options);
  if (!storage) {
    return false;
  }

  try {
    storage.setItem("jskit.themePreference", normalizeThemePreference(themePreference));
    return true;
  } catch {
    return false;
  }
}

function resolveBootstrapThemePreference(payload = {}, options = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const session = source.session && typeof source.session === "object" ? source.session : {};
  if (session.authenticated === true) {
    const userSettings = source.userSettings && typeof source.userSettings === "object" ? source.userSettings : {};
    return normalizeThemePreference(userSettings.theme);
  }

  return readPersistedThemePreference(options);
}

function resolveBootstrapThemeName(payload = {}, options = {}) {
  return resolveThemeNameForPreference(resolveBootstrapThemePreference(payload, options), options);
}

function persistBootstrapThemePreference(payload = {}, options = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const session = source.session && typeof source.session === "object" ? source.session : {};
  if (session.authenticated !== true) {
    return false;
  }

  return persistThemePreference(resolveBootstrapThemePreference(payload, options), options);
}

function resolveVuetifyThemeController(vueApp) {
  return vueApp._context.provides[ThemeSymbol] || null;
}

/**
 * @param {import("vuetify").ThemeInstance} themeController
 * @param {string} themeName
 */
function setVuetifyThemeName(themeController, themeName) {
  const normalizedThemeName = themeName === THEME_PREFERENCE_DARK ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
  if (themeController.name.value === normalizedThemeName) {
    return false;
  }

  void themeController.change(normalizedThemeName);
  return true;
}

export {
  THEME_PREFERENCE_DARK,
  THEME_PREFERENCE_LIGHT,
  THEME_PREFERENCE_SYSTEM,
  normalizeThemePreference,
  persistBootstrapThemePreference,
  persistThemePreference,
  readPersistedThemePreference,
  resolveBootstrapThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyThemeName
};
