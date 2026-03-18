import assert from "node:assert/strict";
import test from "node:test";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import {
  normalizeThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyThemeName
} from "../src/client/lib/theme.js";

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
  const themeController = {
    global: {
      name: {
        value: "light"
      }
    }
  };
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
  const themeController = {
    global: {
      name: {
        value: "light"
      }
    }
  };

  assert.equal(setVuetifyThemeName(themeController, "light"), false);
  assert.equal(setVuetifyThemeName(themeController, "dark"), true);
  assert.equal(themeController.global.name.value, "dark");
});

