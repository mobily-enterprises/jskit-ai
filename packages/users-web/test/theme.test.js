import assert from "node:assert/strict";
import test from "node:test";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import {
  normalizeThemePreference,
  persistBootstrapThemePreference,
  persistThemePreference,
  readPersistedThemePreference,
  resolveBootstrapThemePreference,
  resolveThemeNameForPreference,
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
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
