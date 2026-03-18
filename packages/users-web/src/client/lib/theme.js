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
    const prefersDarkFromMedia = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDarkFromMedia ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
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

function resolveBootstrapThemeName(payload = {}, options = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const session = source.session && typeof source.session === "object" ? source.session : {};
  if (session.authenticated !== true) {
    return THEME_PREFERENCE_LIGHT;
  }

  const userSettings = source.userSettings && typeof source.userSettings === "object" ? source.userSettings : {};
  return resolveThemeNameForPreference(userSettings.theme, options);
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
  if (
    !themeController ||
    typeof themeController !== "object" ||
    !themeController.global ||
    !themeController.global.name
  ) {
    return null;
  }

  return themeController;
}

function setVuetifyThemeName(themeController, themeName) {
  if (
    !themeController ||
    typeof themeController !== "object" ||
    !themeController.global ||
    !themeController.global.name
  ) {
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
  normalizeThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyThemeName
};

