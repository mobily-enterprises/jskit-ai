import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Hct, argbFromHex } from "@material/material-color-utilities";
import { materialThemes, createMaterialVuetifyOptions } from "../src/client/index.js";
import { materialSymbols, vuetifyAliasNames } from "../src/client/symbols.js";
import { buildSymbolsSource } from "../scripts/generate-symbols.mjs";

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const KEBAB = /^[a-z]+(?:-[a-z0-9]+)*$/u;
const HEX = /^#[0-9a-f]{6}$/u;
const MATERIAL_ROLES = [
  "primary", "on-primary", "primary-container", "on-primary-container", "inverse-primary",
  "secondary", "on-secondary", "secondary-container", "on-secondary-container",
  "tertiary", "on-tertiary", "tertiary-container", "on-tertiary-container",
  "error", "on-error", "error-container", "on-error-container",
  "background", "on-background", "surface", "on-surface", "surface-variant", "on-surface-variant",
  "surface-dim", "surface-bright", "surface-container-lowest", "surface-container-low", "surface-container",
  "surface-container-high", "surface-container-highest", "inverse-surface", "inverse-on-surface",
  "outline", "outline-variant", "shadow", "scrim", "surface-tint",
  "primary-fixed", "primary-fixed-dim", "on-primary-fixed", "on-primary-fixed-variant",
  "secondary-fixed", "secondary-fixed-dim", "on-secondary-fixed", "on-secondary-fixed-variant",
  "tertiary-fixed", "tertiary-fixed-dim", "on-tertiary-fixed", "on-tertiary-fixed-variant"
];

test("one seed generates every Material 3 role, light and dark, in kebab-case", () => {
  const themes = materialThemes("#6750A4");
  assert.deepEqual(Object.keys(themes), ["light", "dark"]);
  assert.equal(themes.light.dark, false);
  assert.equal(themes.dark.dark, true);
  for (const theme of [themes.light, themes.dark]) {
    for (const role of MATERIAL_ROLES) {
      assert.match(theme.colors[role], HEX, role);
    }
    for (const [name, value] of Object.entries(theme.colors)) {
      assert.match(name, KEBAB, name);
      assert.match(value, HEX, name);
    }
  }
  // Material Color Utilities' SchemeTonalSpot values for the baseline seed.
  assert.equal(themes.light.colors.primary, "#65558f");
  assert.equal(themes.dark.colors.primary, "#cfbdfe");
  assert.equal(themes.light.colors["secondary-container"], "#e8def8");
  assert.equal(themes.light.colors.surface, "#fdf7ff");
  assert.equal(themes.dark.colors.surface, "#141218");
  assert.equal(themes.light.colors["surface-container-highest"], "#e6e0e9");
});

test("status colours come from customColor harmonized to the seed, each with its container roles", () => {
  const themes = materialThemes("#6750A4");
  for (const status of ["success", "warning", "info"]) {
    for (const theme of [themes.light, themes.dark]) {
      for (const role of [status, `on-${status}`, `${status}-container`, `on-${status}-container`]) {
        assert.match(theme.colors[role], HEX, role);
      }
    }
  }
  // A red seed pulls the green the other way round the hue circle from the baseline purple.
  assert.notEqual(materialThemes("#B3261E").light.colors.success, themes.light.colors.success);
  assert.equal(themes.light.colors["surface-light"], themes.light.colors["surface-container-highest"]);
  for (const theme of [themes.light, themes.dark]) {
    assert.equal(theme.colors["on-surface-container"], theme.colors["on-surface"]);
    assert.equal(theme.colors["on-surface-container-high"], theme.colors["on-surface"]);
  }
});

test("an app's own colours become harmonized custom colour roles, light and dark", () => {
  const themes = materialThemes("#6750A4", { partner: "#0A7D3E", brandAccent: "#FF6D00" });
  for (const theme of [themes.light, themes.dark]) {
    for (const role of ["partner", "on-partner", "partner-container", "on-partner-container", "brand-accent", "on-brand-accent-container"]) {
      assert.match(theme.colors[role], HEX, role);
    }
  }
  assert.notEqual(themes.light.colors.partner, themes.dark.colors.partner);
  assert.notEqual(
    materialThemes("#B3261E", { partner: "#0A7D3E" }).light.colors.partner,
    themes.light.colors.partner,
    "a custom colour is harmonized toward the seed"
  );
  assert.throws(() => materialThemes("#6750A4", { "partner-green": "#0A7D3E" }), /camelCase name/u);
  assert.throws(() => materialThemes("#6750A4", { error: "#0A7D3E" }), /replace the scheme's "error" role/u);
  assert.throws(() => materialThemes("#6750A4", { surfaceContainer: "#0A7D3E" }), /"surface-container" role/u);
  assert.throws(() => materialThemes("#6750A4", { partner: "green" }), /six-digit hex/u);
  assert.deepEqual(
    Object.keys(createMaterialVuetifyOptions({ colors: { partner: "#0A7D3E" } }).theme.themes.light.colors)
      .filter((role) => role.includes("partner")),
    ["partner", "on-partner", "partner-container", "on-partner-container"]
  );
});

test("an app colour with blend: false keeps its own hue; a hex string or { value } stays harmonized", () => {
  const hue = (hex) => Hct.fromInt(argbFromHex(hex)).hue;
  const learning = "#F5C518";
  const kept = materialThemes("#6750A4", { learning: { value: learning, blend: false } });
  const blended = materialThemes("#6750A4", { learning });
  for (const scheme of ["light", "dark"]) {
    for (const role of ["learning", "learning-container"]) {
      assert.ok(Math.abs(hue(kept[scheme].colors[role]) - hue(learning)) < 3, `${scheme} ${role} keeps the colour's hue`);
      assert.ok(Math.abs(hue(blended[scheme].colors[role]) - hue(learning)) > 5, `${scheme} ${role} moves toward the seed`);
    }
    assert.match(kept[scheme].colors["on-learning-container"], HEX);
  }
  assert.deepEqual(materialThemes("#6750A4", { learning: { value: learning } }), blended);
  assert.deepEqual(materialThemes("#6750A4", { learning: { value: learning, blend: true } }), blended);
  assert.throws(() => materialThemes("#6750A4", { learning: { value: learning, blend: "no" } }), /blend: true or false/u);
  assert.throws(() => materialThemes("#6750A4", { learning: { blend: false } }), /six-digit hex/u);
});

test("theme variables carry Material 3 state layers and channel strings for border and shadow", () => {
  const { light, dark } = materialThemes("#6750A4");
  for (const theme of [light, dark]) {
    assert.equal(theme.variables["hover-opacity"], 0.08);
    assert.equal(theme.variables["focus-opacity"], 0.1);
    assert.equal(theme.variables["pressed-opacity"], 0.1);
    assert.equal(theme.variables["dragged-opacity"], 0.16);
    assert.match(theme.variables["border-color"], /^\d+, \d+, \d+$/u);
    assert.match(theme.variables["shadow-color"], /^\d+, \d+, \d+$/u);
  }
  assert.equal(light.variables["border-color"], "202, 196, 207");
});

test("a seed that is not a six-digit hex colour is refused", () => {
  assert.throws(() => materialThemes("purple"), /six-digit hex/u);
  assert.throws(() => createMaterialVuetifyOptions({ seed: "#123" }), /six-digit hex/u);
});

test("the Vuetify options follow the system scheme on the md3 blueprint with Material Symbols", () => {
  const options = createMaterialVuetifyOptions({
    seed: "#006A6A",
    icons: { myLeaf: "M1 1h22v22H1z" }
  });
  assert.equal(options.theme.defaultTheme, "system");
  assert.deepEqual(Object.keys(options.theme.themes), ["light", "dark"]);
  assert.ok(options.blueprint.defaults.VBtn);
  assert.equal(options.icons.defaultSet, "svg");
  assert.equal(options.icons.aliases.arrowBack, materialSymbols.arrowBack);
  assert.equal(options.icons.aliases.myLeaf, "svg:M1 1h22v22H1z");
  assert.equal(options.defaults.VCard.rounded, 12);
  // Vuetify's elevated variant draws the card's level 1; a default elevation would also lift flat and tonal cards.
  assert.equal("elevation" in options.defaults.VCard, false);
  assert.equal("elevation" in options.defaults.VBottomSheet.VCard, false);
  assert.equal(options.defaults.VChip.rounded, 8);
  assert.equal(options.defaults.VFab.rounded, 16);
  assert.equal(options.defaults.VChip.closeIcon, "$close");
  assert.equal(options.defaults.VSwitch.inset, "material");
  assert.equal(options.defaults.VSnackbar.color, "inverse-surface");
  assert.throws(() => createMaterialVuetifyOptions({ icons: { "my-leaf": "M0 0" } }), /camelCase/u);
});

test("every icon alias is a Material Symbols path and replaces every Vuetify alias", async () => {
  const vuetifyIconset = await readFile(require.resolve("vuetify/iconsets/mdi"), "utf8");
  const vuetifyAliases = [...vuetifyIconset.matchAll(/^ {2}(\w+): '/gmu)].map((match) => match[1]);
  assert.ok(vuetifyAliases.length > 50);
  assert.deepEqual([...vuetifyAliases].sort(), [...vuetifyAliasNames].sort());
  for (const [name, value] of Object.entries(materialSymbols)) {
    assert.match(name, /^[a-z][A-Za-z0-9]*$/u);
    assert.match(value, /^svg:[Mm][-0-9.,A-Za-z ]+$/u, name);
  }
  for (const alias of ["arrowBack", "add", "delete", "moreVert", "search", "filterList", "home", "homeFilled"]) {
    assert.ok(materialSymbols[alias], alias);
  }
  assert.notEqual(materialSymbols.home, materialSymbols.homeFilled);
});

test("the generated symbols file is current", async () => {
  const current = await readFile(path.join(PACKAGE_ROOT, "src/client/symbols.js"), "utf8");
  assert.equal(current, await buildSymbolsSource());
});

test("material.css holds the exact-size rules without Sass or !important", async () => {
  const css = await readFile(path.join(PACKAGE_ROOT, "src/client/material.css"), "utf8");
  assert.doesNotMatch(css, /!important/u);
  assert.doesNotMatch(css, /\$[a-z-]+\s*:/u);
  assert.match(css, /--v-btn-height: 40px/u);
  assert.match(css, /height: max\(100%, 48px\)/u);
  // Every button size gets the touch target, not only the default one, and a long label ends in an ellipsis.
  assert.match(css, /\.v-btn:not\(\.v-btn--stacked\)::before \{[^}]*width: max\(100%, 48px\);/u);
  assert.match(css, /\.v-btn:not\(\.v-btn--stacked\) \{[^}]*contain: layout;/u);
  // FABs keep their own sizes: the common and icon button sizes leave them out.
  assert.match(css, /\.v-btn--size-default:not\(\.v-btn--stacked, \.v-btn--icon, \.v-fab \.v-btn\) \{[^}]*--v-btn-height: 40px;/u);
  assert.match(css, /\.v-btn--icon\.v-btn--size-default:not\(\.v-fab \.v-btn\) \{[^}]*--v-btn-height: 28px;/u);
  assert.match(css, /\.v-fab--extended \.v-btn \{[^}]*--v-btn-height: var\(--jskit-fab-size\);/u);
  assert.doesNotMatch(css, /\.v-btn--size-default:not\(\.v-btn--stacked\)::before/u);
  assert.match(css, /> \.v-btn__content:not\(:has\(> \*\)\) \{[^}]*text-overflow: ellipsis;/u);
  assert.match(css, /border-radius: 28px;/u);
  assert.match(css, /v-dialog--fullscreen[^{]+\{\s*border-radius: 0;/u);
  assert.match(css, /border-radius: 28px 28px 0 0/u);
  assert.match(css, /cubic-bezier\(0\.2, 0, 0, 1\)/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /Roboto Flex/u);
  assert.match(css, /@layer vuetify-overrides \{/u);
  assert.match(css, /\.text-on-surface-variant \{\s*color: rgb\(var\(--v-theme-on-surface-variant\)\);/u);
});
