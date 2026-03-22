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

function buildWorkspaceOverrideCss(themeInput = {}) {
  const palette = resolveWorkspaceThemePalette(themeInput);
  return `.v-theme--light, .v-theme--dark {\n  --v-theme-primary: ${hexColorToRgb(
    palette.color
  )};\n  --v-theme-secondary: ${hexColorToRgb(palette.secondaryColor)};\n  --v-theme-surface: ${hexColorToRgb(
    palette.surfaceColor
  )};\n  --v-theme-surface-variant: ${hexColorToRgb(
    palette.surfaceVariantColor
  )};\n  --v-theme-background: ${hexColorToRgb(palette.backgroundColor)};\n}`;
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

test("hexColorToRgb returns Vuetify rgb tuple and rejects invalid values", () => {
  assert.equal(hexColorToRgb("#0f6b54"), "15,107,84");
  assert.equal(hexColorToRgb("#CC3344"), "204,51,68");
  assert.equal(hexColorToRgb("invalid"), "");
});

test("setVuetifyPrimaryColorOverride writes and removes workspace override stylesheet", () => {
  const styleElement = {
    id: "",
    textContent: "",
    removeCalled: false,
    remove() {
      this.removeCalled = true;
      documentStub._styleElement = null;
    }
  };
  const documentStub = {
    _styleElement: null,
    head: {
      appendChild(element) {
        documentStub._styleElement = element;
      }
    },
    createElement() {
      return styleElement;
    },
    getElementById(id) {
      if (id !== "jskit-users-web-workspace-primary-override") {
        return null;
      }
      return documentStub._styleElement;
    }
  };

  assert.equal(setVuetifyPrimaryColorOverride({ color: "#CC3344" }, { documentRef: documentStub }), true);
  assert.equal(
    styleElement.textContent,
    buildWorkspaceOverrideCss({
      color: "#CC3344"
    })
  );

  assert.equal(setVuetifyPrimaryColorOverride({ color: "#CC3344" }, { documentRef: documentStub }), false);
  assert.equal(setVuetifyPrimaryColorOverride("", { documentRef: documentStub }), true);
  assert.equal(styleElement.removeCalled, true);
  assert.equal(setVuetifyPrimaryColorOverride("", { documentRef: documentStub }), false);
});
