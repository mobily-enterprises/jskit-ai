import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { resolveWorkspaceThemePalette } from "@jskit-ai/workspaces-core/shared/settings";

const THEME_PREFERENCE_LIGHT = "light";
const THEME_PREFERENCE_DARK = "dark";
const THEME_PREFERENCE_SYSTEM = "system";
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const WORKSPACE_THEME_NAME_LIGHT = "workspace-light";
const WORKSPACE_THEME_NAME_DARK = "workspace-dark";

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

function resolveThemePreferenceStorage(options = {}) {
  const customStorage = options && typeof options === "object" ? options.storage : null;
  if (customStorage && typeof customStorage === "object") {
    return customStorage;
  }

  if (typeof window !== "object" || !window) {
    return null;
  }

  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    return null;
  }
  if (!storage || typeof storage !== "object") {
    return null;
  }
  return storage;
}

function readPersistedThemePreference(options = {}) {
  const storage = resolveThemePreferenceStorage(options);
  if (!storage || typeof storage.getItem !== "function") {
    return THEME_PREFERENCE_SYSTEM;
  }

  try {
    const value = storage.getItem("jskit.themePreference");
    return normalizeThemePreference(value);
  } catch {
    return THEME_PREFERENCE_SYSTEM;
  }
}

function persistThemePreference(themePreference, options = {}) {
  const storage = resolveThemePreferenceStorage(options);
  if (!storage || typeof storage.setItem !== "function") {
    return false;
  }

  const normalizedPreference = normalizeThemePreference(themePreference);
  try {
    storage.setItem("jskit.themePreference", normalizedPreference);
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

function normalizeHexColor(value = "") {
  const normalized = String(value || "").trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return "";
  }
  return normalized.toUpperCase();
}

function hexColorToRgb(value = "") {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return "";
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `${red},${green},${blue}`;
}

function resolveVuetifyThemeDefinitions(themeController) {
  if (!themeController || typeof themeController !== "object") {
    return null;
  }
  const themes = themeController.themes?.value;
  if (!themes || typeof themes !== "object") {
    return null;
  }
  return themes;
}

function normalizeThemeColors(colors) {
  const source = colors && typeof colors === "object" ? colors : {};
  const normalized = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[String(key)] = String(value);
  }
  return normalized;
}

function normalizeWorkspaceBaseThemeName(themeName = "") {
  const normalized = String(themeName || "").trim().toLowerCase();
  if (normalized === WORKSPACE_THEME_NAME_LIGHT) {
    return THEME_PREFERENCE_LIGHT;
  }
  if (normalized === WORKSPACE_THEME_NAME_DARK) {
    return THEME_PREFERENCE_DARK;
  }
  if (normalized === THEME_PREFERENCE_DARK) {
    return THEME_PREFERENCE_DARK;
  }
  return THEME_PREFERENCE_LIGHT;
}

function areThemeColorsEqual(leftColors = {}, rightColors = {}) {
  const leftEntries = Object.entries(leftColors);
  const rightEntries = Object.entries(rightColors);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (!Object.hasOwn(rightColors, key)) {
      return false;
    }
    if (String(rightColors[key]) !== String(value)) {
      return false;
    }
  }
  return true;
}

function composeWorkspaceThemeDefinition(baseThemeDefinition, palette) {
  const baseTheme = baseThemeDefinition && typeof baseThemeDefinition === "object" ? baseThemeDefinition : {};
  const baseColors = normalizeThemeColors(baseTheme.colors);
  return {
    ...baseTheme,
    colors: {
      ...baseColors,
      primary: palette.color,
      secondary: palette.secondaryColor,
      surface: palette.surfaceColor,
      "surface-variant": palette.surfaceVariantColor
    }
  };
}

function upsertThemeDefinition(themeDefinitions, themeName, nextDefinition) {
  const currentDefinition =
    themeDefinitions[themeName] && typeof themeDefinitions[themeName] === "object" ? themeDefinitions[themeName] : null;
  const currentColors = normalizeThemeColors(currentDefinition?.colors);
  const nextColors = normalizeThemeColors(nextDefinition?.colors);
  const sameDarkFlag = Boolean(currentDefinition?.dark) === Boolean(nextDefinition?.dark);
  if (sameDarkFlag && areThemeColorsEqual(currentColors, nextColors)) {
    return false;
  }
  themeDefinitions[themeName] = nextDefinition;
  return true;
}

function setVuetifyPrimaryColorOverride(themeController, themeInput = null) {
  if (
    !themeController ||
    typeof themeController !== "object" ||
    !themeController.global ||
    !themeController.global.name
  ) {
    return false;
  }

  const themeDefinitions = resolveVuetifyThemeDefinitions(themeController);
  if (!themeDefinitions) {
    return false;
  }

  const currentThemeName = String(themeController.global.name.value || "").trim();
  const normalizedBaseThemeName = normalizeWorkspaceBaseThemeName(currentThemeName);
  const normalizedThemeName =
    normalizedBaseThemeName === THEME_PREFERENCE_DARK ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
  const source = themeInput && typeof themeInput === "object" ? themeInput : null;

  if (!source) {
    if (currentThemeName === normalizedThemeName) {
      return false;
    }
    themeController.global.name.value = normalizedThemeName;
    return true;
  }

  const baseLightTheme =
    themeDefinitions[THEME_PREFERENCE_LIGHT] && typeof themeDefinitions[THEME_PREFERENCE_LIGHT] === "object"
      ? themeDefinitions[THEME_PREFERENCE_LIGHT]
      : null;
  const baseDarkTheme =
    themeDefinitions[THEME_PREFERENCE_DARK] && typeof themeDefinitions[THEME_PREFERENCE_DARK] === "object"
      ? themeDefinitions[THEME_PREFERENCE_DARK]
      : null;
  if (!baseLightTheme || !baseDarkTheme) {
    return false;
  }

  const lightPalette = resolveWorkspaceThemePalette(source, { mode: THEME_PREFERENCE_LIGHT });
  const darkPalette = resolveWorkspaceThemePalette(source, { mode: THEME_PREFERENCE_DARK });
  const nextLightTheme = composeWorkspaceThemeDefinition(baseLightTheme, lightPalette);
  const nextDarkTheme = composeWorkspaceThemeDefinition(baseDarkTheme, darkPalette);
  const nextThemeName =
    normalizedThemeName === THEME_PREFERENCE_DARK ? WORKSPACE_THEME_NAME_DARK : WORKSPACE_THEME_NAME_LIGHT;

  let changed = false;
  changed = upsertThemeDefinition(themeDefinitions, WORKSPACE_THEME_NAME_LIGHT, nextLightTheme) || changed;
  changed = upsertThemeDefinition(themeDefinitions, WORKSPACE_THEME_NAME_DARK, nextDarkTheme) || changed;
  if (themeController.global.name.value !== nextThemeName) {
    themeController.global.name.value = nextThemeName;
    changed = true;
  }

  return changed;
}

export {
  hexColorToRgb,
  normalizeThemePreference,
  persistBootstrapThemePreference,
  persistThemePreference,
  readPersistedThemePreference,
  resolveBootstrapThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyPrimaryColorOverride,
  setVuetifyThemeName
};
