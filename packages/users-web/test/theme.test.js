import assert from "node:assert/strict";
import test from "node:test";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { resolveWorkspaceThemePalette } from "@jskit-ai/users-core/shared/settings";
import {
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

test("resolveBootstrapThemeName uses persisted preference for unauthenticated payloads", () => {
  const storage = new Map();
  storage.set("jskit.themePreference", "dark");

  assert.equal(
    resolveBootstrapThemeName({
      session: { authenticated: false },
      userSettings: { theme: "light" }
    }, {
      storage: {
        getItem(key) {
          return storage.get(key) || null;
        }
      },
      prefersDark: false
    }),
    "dark"
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

test("theme preference persistence helpers normalize values", () => {
  const storage = new Map();
  const storageAdapter = {
    getItem(key) {
      return storage.get(key) || null;
    },
    setItem(key, value) {
      storage.set(key, value);
    }
  };

  assert.equal(readPersistedThemePreference({ storage: storageAdapter }), "system");
  assert.equal(persistThemePreference(" DARK ", { storage: storageAdapter }), true);
  assert.equal(readPersistedThemePreference({ storage: storageAdapter }), "dark");

  assert.equal(
    resolveBootstrapThemePreference(
      {
        session: { authenticated: false }
      },
      { storage: storageAdapter }
    ),
    "dark"
  );
  assert.equal(
    persistBootstrapThemePreference(
      {
        session: { authenticated: true },
        userSettings: {
          theme: "light"
        }
      },
      { storage: storageAdapter }
    ),
    true
  );
  assert.equal(readPersistedThemePreference({ storage: storageAdapter }), "light");
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
  const themeInput = {
    lightPrimaryColor: "#CC3344",
    lightSecondaryColor: "#884455",
    lightSurfaceColor: "#F4F4F4",
    lightSurfaceVariantColor: "#444444",
    darkPrimaryColor: "#BB2233",
    darkSecondaryColor: "#557799",
    darkSurfaceColor: "#202020",
    darkSurfaceVariantColor: "#A0A0A0"
  };
  const expectedLightPalette = resolveWorkspaceThemePalette(themeInput, {
    mode: "light"
  });
  const expectedDarkPalette = resolveWorkspaceThemePalette(themeInput, {
    mode: "dark"
  });

  assert.equal(setVuetifyPrimaryColorOverride(themeController, themeInput), true);
  assert.equal(themeController.global.name.value, "workspace-light");
  assert.equal(themeController.themes.value["workspace-light"].colors.primary, expectedLightPalette.color);
  assert.equal(themeController.themes.value["workspace-light"].colors.secondary, expectedLightPalette.secondaryColor);
  assert.equal(themeController.themes.value["workspace-light"].colors.surface, expectedLightPalette.surfaceColor);
  assert.equal(
    themeController.themes.value["workspace-light"].colors["surface-variant"],
    expectedLightPalette.surfaceVariantColor
  );

  assert.equal(setVuetifyPrimaryColorOverride(themeController, themeInput), false);

  assert.equal(setVuetifyThemeName(themeController, "dark"), true);
  assert.equal(setVuetifyPrimaryColorOverride(themeController, themeInput), true);
  assert.equal(themeController.global.name.value, "workspace-dark");
  assert.equal(themeController.themes.value["workspace-dark"].colors.primary, expectedDarkPalette.color);
  assert.equal(themeController.themes.value["workspace-dark"].colors.secondary, expectedDarkPalette.secondaryColor);
  assert.equal(themeController.themes.value["workspace-dark"].colors.surface, expectedDarkPalette.surfaceColor);
  assert.equal(
    themeController.themes.value["workspace-dark"].colors["surface-variant"],
    expectedDarkPalette.surfaceVariantColor
  );

  assert.equal(setVuetifyPrimaryColorOverride(themeController, null), true);
  assert.equal(themeController.global.name.value, "dark");
  assert.equal(setVuetifyPrimaryColorOverride(themeController, null), false);
});
