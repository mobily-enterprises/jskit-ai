import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { resolveWorkspaceThemePalette } from "@jskit-ai/users-core/shared/settings";

const THEME_PREFERENCE_LIGHT = "light";
const THEME_PREFERENCE_DARK = "dark";
const THEME_PREFERENCE_SYSTEM = "system";
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const WORKSPACE_PRIMARY_OVERRIDE_STYLE_ID = "jskit-users-web-workspace-primary-override";

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

function normalizeHexColor(value = "") {
  const normalized = String(value || "").trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return "";
  }
  return normalized.toUpperCase();
}

function resolveDocumentObject(documentRef = null) {
  if (documentRef && typeof documentRef === "object") {
    return documentRef;
  }
  if (typeof document === "object" && document) {
    return document;
  }
  return null;
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

function resolveWorkspacePrimaryOverrideStyleElement(doc = null) {
  if (!doc || typeof doc.getElementById !== "function") {
    return null;
  }
  return doc.getElementById(WORKSPACE_PRIMARY_OVERRIDE_STYLE_ID);
}

function ensureWorkspacePrimaryOverrideStyleElement(doc = null) {
  if (!doc || typeof doc !== "object") {
    return null;
  }
  const existing = resolveWorkspacePrimaryOverrideStyleElement(doc);
  if (existing) {
    return existing;
  }
  if (!doc.head || typeof doc.createElement !== "function" || typeof doc.head.appendChild !== "function") {
    return null;
  }
  const styleElement = doc.createElement("style");
  styleElement.id = WORKSPACE_PRIMARY_OVERRIDE_STYLE_ID;
  doc.head.appendChild(styleElement);
  return styleElement;
}

function setVuetifyPrimaryColorOverride(themeInput = null, { documentRef = null } = {}) {
  const doc = resolveDocumentObject(documentRef);
  if (!doc) {
    return false;
  }
  const source = themeInput && typeof themeInput === "object" ? themeInput : null;
  const nextPalette = source ? resolveWorkspaceThemePalette(source) : null;
  const existingStyleElement = resolveWorkspacePrimaryOverrideStyleElement(doc);
  if (!nextPalette) {
    if (!existingStyleElement) {
      return false;
    }
    if (typeof existingStyleElement.remove === "function") {
      existingStyleElement.remove();
      return true;
    }
    return false;
  }

  const styleElement = existingStyleElement || ensureWorkspacePrimaryOverrideStyleElement(doc);
  if (!styleElement) {
    return false;
  }
  const nextCssText = `.v-theme--light, .v-theme--dark {\n  --v-theme-primary: ${hexColorToRgb(nextPalette.color)};\n  --v-theme-secondary: ${hexColorToRgb(nextPalette.secondaryColor)};\n  --v-theme-surface: ${hexColorToRgb(nextPalette.surfaceColor)};\n  --v-theme-surface-variant: ${hexColorToRgb(nextPalette.surfaceVariantColor)};\n  --v-theme-background: ${hexColorToRgb(nextPalette.backgroundColor)};\n}`;
  if (String(styleElement.textContent || "") === nextCssText) {
    return false;
  }
  styleElement.textContent = nextCssText;
  return true;
}

export {
  hexColorToRgb,
  normalizeThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyPrimaryColorOverride,
  setVuetifyThemeName
};
