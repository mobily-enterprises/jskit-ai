import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceThemePalette } from "@jskit-ai/workspaces-core/shared/settings";
import {
  hexColorToRgb,
  setVuetifyPrimaryColorOverride,
  setVuetifyThemeName
} from "../src/client/lib/theme.js";
import { createVuetifyThemeController } from "./support/vuetifyThemeController.js";

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
