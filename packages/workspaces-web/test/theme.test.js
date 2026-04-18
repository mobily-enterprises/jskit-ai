import assert from "node:assert/strict";
import test from "node:test";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { resolveWorkspaceThemePalette } from "@jskit-ai/workspaces-core/shared/settings";
import {
  hexColorToRgb,
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
    },
    _context: {
      provides: {
        [ThemeSymbol]: null
      }
    }
  };
}

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
