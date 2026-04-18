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

function resolveSystemThemeName({ prefersDark } = {}) {
  if (typeof prefersDark === "boolean") {
    return prefersDark ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? THEME_PREFERENCE_DARK
      : THEME_PREFERENCE_LIGHT;
  }

  return THEME_PREFERENCE_LIGHT;
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

  if (typeof window !== "object" || !window) {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedThemePreference(options = {}) {
  const storage = resolveThemePreferenceStorage(options);
  if (!storage || typeof storage.getItem !== "function") {
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
  if (!storage || typeof storage.setItem !== "function") {
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
  if (!vueApp || typeof vueApp !== "object") {
    return null;
  }

  const provides = vueApp._context?.provides;
  if (!provides || typeof provides !== "object") {
    return null;
  }

  const themeController = provides[ThemeSymbol];
  if (!themeController || typeof themeController !== "object" || !themeController.global || !themeController.global.name) {
    return null;
  }

  return themeController;
}

function setVuetifyThemeName(themeController, themeName) {
  if (!themeController || typeof themeController !== "object" || !themeController.global || !themeController.global.name) {
    return false;
  }

  const normalizedThemeName = themeName === THEME_PREFERENCE_DARK ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
  if (themeController.global.name.value === normalizedThemeName) {
    return false;
  }

  themeController.global.name.value = normalizedThemeName;
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
