import assert from "node:assert/strict";
import test from "node:test";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { resolveWorkspaceThemePalette } from "@jskit-ai/users-core/shared/settings";
import {
  hexColorToRgb,
  normalizeThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyPrimaryColorOverride,
  setVuetifyThemeName
} from "../src/client/lib/theme.js";

function createVuetifyThemeController(initialTheme = "light") {
  return {
    global: {
      name: {
        value: initialTheme
      }
    },
    themes: {
      value: {
        light: {
          dark: false,
          colors: {
            primary: "#0f6b54",
            secondary: "#3f5150",
            background: "#eef3ee",
            surface: "#f7fbf6",
            "surface-variant": "#dfe8df"
          }
        },
        dark: {
          dark: true,
          colors: {
            primary: "#6fd0b5",
            secondary: "#9db2af",
            background: "#0f1715",
            surface: "#16211e",
            "surface-variant": "#253430"
          }
        }
      }
    }
  };
}

test("normalizeThemePreference accepts known preferences and falls back to system", () => {
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference(" DARK "), "dark");
  assert.equal(normalizeThemePreference("system"), "system");
  assert.equal(normalizeThemePreference("unknown"), "system");
});

test("resolveThemeNameForPreference resolves system using explicit prefersDark", () => {
  assert.equal(resolveThemeNameForPreference("system", { prefersDark: true }), "dark");
  assert.equal(resolveThemeNameForPreference("system", { prefersDark: false }), "light");
  assert.equal(resolveThemeNameForPreference("dark", { prefersDark: false }), "dark");
  assert.equal(resolveThemeNameForPreference("light", { prefersDark: true }), "light");
});

test("resolveBootstrapThemeName keeps unauthenticated payload in light theme", () => {
  assert.equal(
    resolveBootstrapThemeName(
      {
        session: { authenticated: false },
        userSettings: { theme: "dark" }
      },
      { prefersDark: true }
    ),
    "light"
  );
});

test("resolveBootstrapThemeName uses authenticated user preference", () => {
  assert.equal(
    resolveBootstrapThemeName(
      {
        session: { authenticated: true },
        userSettings: { theme: "dark" }
      },
      { prefersDark: false }
    ),
    "dark"
  );
  assert.equal(
    resolveBootstrapThemeName(
      {
        session: { authenticated: true },
        userSettings: { theme: "system" }
      },
      { prefersDark: true }
    ),
    "dark"
  );
});

test("resolveVuetifyThemeController reads theme controller from Vue app provides", () => {
  const themeController = createVuetifyThemeController("light");
  const vueApp = {
    _context: {
      provides: {
        [ThemeSymbol]: themeController
      }
    }
  };

  assert.equal(resolveVuetifyThemeController(vueApp), themeController);
  assert.equal(resolveVuetifyThemeController({ _context: { provides: {} } }), null);
});

test("setVuetifyThemeName updates only when the value changes", () => {
  const themeController = createVuetifyThemeController("light");

  assert.equal(setVuetifyThemeName(themeController, "light"), false);
  assert.equal(setVuetifyThemeName(themeController, "dark"), true);
  assert.equal(themeController.global.name.value, "dark");
});

test("hexColorToRgb returns Vuetify rgb tuple and rejects invalid values", () => {
  assert.equal(hexColorToRgb("#0f6b54"), "15,107,84");
  assert.equal(hexColorToRgb("#CC3344"), "204,51,68");
  assert.equal(hexColorToRgb("invalid"), "");
});

test("setVuetifyPrimaryColorOverride mutates workspace themes and restores base theme names", () => {
  const themeController = createVuetifyThemeController("light");
  const expectedPalette = resolveWorkspaceThemePalette({
    color: "#CC3344"
  });

  assert.equal(setVuetifyPrimaryColorOverride(themeController, { color: "#CC3344" }), true);
  assert.equal(themeController.global.name.value, "workspace-light");
  assert.equal(themeController.themes.value["workspace-light"].colors.primary, expectedPalette.color);
  assert.equal(themeController.themes.value["workspace-light"].colors.secondary, expectedPalette.secondaryColor);
  assert.equal(themeController.themes.value["workspace-light"].colors.surface, expectedPalette.surfaceColor);
  assert.equal(
    themeController.themes.value["workspace-light"].colors["surface-variant"],
    expectedPalette.surfaceVariantColor
  );
  assert.equal(themeController.themes.value["workspace-light"].colors.background, expectedPalette.backgroundColor);

  assert.equal(setVuetifyPrimaryColorOverride(themeController, { color: "#CC3344" }), false);

  assert.equal(setVuetifyThemeName(themeController, "dark"), true);
  assert.equal(setVuetifyPrimaryColorOverride(themeController, { color: "#CC3344" }), true);
  assert.equal(themeController.global.name.value, "workspace-dark");
  assert.equal(themeController.themes.value["workspace-dark"].colors.primary, expectedPalette.color);

  assert.equal(setVuetifyPrimaryColorOverride(themeController, null), true);
  assert.equal(themeController.global.name.value, "dark");
  assert.equal(setVuetifyPrimaryColorOverride(themeController, null), false);
});
