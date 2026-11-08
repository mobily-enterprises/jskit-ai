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
  // A card's 12dp corners are in material.css; a rounded default would be an inline style a dialog's 28dp couldn't beat.
  assert.ok("rounded" in options.defaults.VCard);
  assert.equal(options.defaults.VCard.rounded, undefined);
  // Cards rest flat; variant="elevated" keeps Material 3's level 1, which a default elevation would add to every card.
  assert.equal(options.defaults.VCard.variant, "flat");
  assert.equal("elevation" in options.defaults.VCard, false);
  assert.deepEqual(options.defaults.VExpansionPanels, { flat: true });
  assert.deepEqual(options.defaults.VBottomSheet, { contentClass: "jskit-material-bottom-sheet" });
  assert.equal(options.defaults.VChip.rounded, 8);
  assert.equal(options.defaults.VFab.rounded, 16);
  assert.equal(options.defaults.VChip.closeIcon, "$close");
  assert.equal(options.defaults.VSwitch.inset, "material");
  assert.equal(options.defaults.VSnackbar.color, "inverse-surface");
  // A button with `to` is active only on exactly its route.
  assert.equal(options.defaults.VBtn.exact, true);
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
  assert.match(
    css,
    /\.v-btn:not\(\.v-btn--stacked\)::before \{[^}]*inset-block: min\(0px, calc\(50% - 24px\)\);[^}]*inset-inline: min\(0px, calc\(50% - 24px\)\);/u
  );
  // A button that follows another stops its target at its own edge on that side, and no icon button is under 32dp,
  // so adjacent compact icon buttons each answer their own presses.
  assert.match(css, /\.v-btn \+ \.v-btn:not\(\.v-btn--stacked\)::before \{\s*inset-inline-start: 0;\s*\}/u);
  assert.match(css, /\.v-btn--icon:not\(\.v-fab \.v-btn\) \{\s*min-height: 32px;\s*min-width: 32px;\s*\}/u);
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

test("segmented buttons and filter chips select in secondary-container; a menu's own list is the menu's container", () => {
  const { defaults } = createMaterialVuetifyOptions();
  assert.deepEqual(defaults.VBtnToggle, {
    border: true,
    color: "secondary-container",
    divided: true,
    rounded: "pill",
    variant: "flat"
  });
  assert.deepEqual(defaults.VChipGroup, { color: "secondary-container", filter: true, variant: "flat" });
  // A menu's own list is drawn by material.css, not VMenu sub-component defaults, under which Vuetify 4.2.1 to 4.3.2
  // lose a v-select's typeahead match when an ancestor re-renders (README, Upstream workarounds).
  assert.equal(defaults.VMenu, undefined, "no VMenu sub-component defaults");
  // VDialog is Vuetify's other root defaults provider: a dialog's card is drawn by material.css too.
  assert.equal(defaults.VDialog, undefined, "no VDialog defaults");
});

test("material.css draws cards, a dialog's card and a bottom sheet's card", async () => {
  const css = await readFile(path.join(PACKAGE_ROOT, "src/client/material.css"), "utf8");
  assert.match(css, /\n {2}\.v-card \{\s*border-radius: 12px;\s*\}/u);
  assert.match(
    css,
    /\.v-dialog:not\(\.v-bottom-sheet\) > \.v-overlay__content > form > \.v-card \{[^}]*box-shadow: 0px 1px 3px 0px[^}]*0px 4px 8px 3px/u
  );
  assert.match(
    css,
    /@layer vuetify-utilities \{[\s\S]*\.v-dialog:not\(\.v-bottom-sheet\) > \.v-overlay__content > form > \.v-card\.bg-surface-container-low \{[^}]*background-color: rgb\(var\(--v-theme-surface-container-high\)\);/u
  );
  assert.match(css, /\.v-bottom-sheet > \.v-overlay__content > form > \.v-card \{\s*border-radius: 0;/u);
});

test("material.css draws a menu's own list as its container and leaves other lists in a menu plain", async () => {
  const css = await readFile(path.join(PACKAGE_ROOT, "src/client/material.css"), "utf8");
  assert.match(
    css,
    /@layer vuetify-utilities \{\s*\/\*[^*]*\*\/\s*\.v-menu > \.v-overlay__content > \.v-list\.bg-transparent \{\s*background-color: rgb\(var\(--v-theme-surface-container\)\);/u
  );
  assert.match(css, /\.v-menu > \.v-overlay__content > \.v-list \{[^}]*box-shadow: 0px 1px 2px 0px[^}]*0px 2px 6px 2px/u);
  assert.doesNotMatch(css, /\.v-menu > \.v-overlay__content > \.v-(?:card|sheet)/u);
});

test("material.css draws segmented buttons, filter chips, fixed tabs and dialog actions as Material 3 does", async () => {
  const css = await readFile(path.join(PACKAGE_ROOT, "src/client/material.css"), "utf8");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return css.match(new RegExp(`(?:^|\\n)\\s*${escaped}[^{]*\\{([^}]*)\\}`, "u"))?.[1] || "";
  };
  // The check a selected segment or filter chip leads with is Material Symbols' own check glyph.
  const check = materialSymbols.check.slice("svg:".length);
  const mask = css.match(/mask: url\("data:image\/svg\+xml,[^"]*d='([^']+)'/u)?.[1];
  assert.equal(mask, check);
  assert.match(rule(".v-btn-toggle.v-btn-group--horizontal"), /grid-auto-columns: 1fr;/u);
  assert.match(rule(".v-btn-toggle.v-btn-group--horizontal.v-btn-group--density-default"), /height: 40px;/u);
  assert.match(rule(".v-btn-toggle"), /border-color: rgb\(var\(--v-theme-outline\)\);[\s\S]*overflow: visible;/u);
  // Every button group's segments have 12dp sides, after the common button's 24dp (and 16dp beside an icon) rules.
  assert.match(rule(".v-btn-group > .v-btn.v-btn--size-default"), /min-width: 48px;\s*padding-inline: 12px;/u);
  assert.ok(css.indexOf(".v-btn-group > .v-btn.v-btn--size-default") > css.indexOf(":has(> .v-btn__append)"));
  assert.match(css, /\.v-chip--filter,\s*\.v-chip\[aria-pressed\] \{[^}]*border: thin solid rgb\(var\(--v-theme-outline\)\);/u);
  assert.match(css, /\.v-chip--filter\.v-chip--selected,\s*\.v-chip\[aria-pressed="true"\] \{[^}]*secondary-container/u);
  assert.match(rule(".v-chip--variant-outlined:not"), /border-color: rgb\(var\(--v-theme-outline\)\);/u);
  assert.match(rule(".v-tabs--grow .v-tab"), /flex: 1 1 0;[\s\S]*min-width: max-content;/u);
  assert.match(css, /\.v-dialog > \.v-overlay__content > \.v-card > \.v-card-actions,[^{]*\{\s*gap: 8px;\s*padding: 0 24px 24px;/u);
  // A pagination's current page has the activated layer, not the border opacity; a shown placeholder is
  // on-surface-variant, and a labelled field still hides it until active.
  assert.match(
    rule(".v-pagination .v-pagination__item--is-active .v-btn__overlay"),
    /opacity: calc\(var\(--v-activated-opacity\) \* var\(--v-theme-overlay-multiplier\)\);/u
  );
  assert.match(
    css,
    /\.v-field:is\(\.v-field--active, \.v-field--no-label\) :is\(input, textarea\)::placeholder \{\s*color: rgb\(var\(--v-theme-on-surface-variant\)\);\s*opacity: 1;/u
  );
  // A resting field's label and a valid field's supporting text are on-surface-variant at full strength, not on-surface
  // at the medium-emphasis opacity.
  assert.match(
    css,
    /\.v-field:not\(\.v-field--focused, \.v-field--error\) \.v-label\.v-field-label \{\s*color: rgb\(var\(--v-theme-on-surface-variant\)\);\s*opacity: 1;/u
  );
  assert.match(
    css,
    /\.v-input:not\(\.v-input--error, \.v-input--disabled\) > \.v-input__details \.v-messages \{\s*color: rgb\(var\(--v-theme-on-surface-variant\)\);\s*opacity: 1;/u
  );
  // So is an inactive, uncoloured list item's subtitle.
  assert.match(
    css,
    /\.v-list-item:not\(\.v-list-item--active, \.v-list-item--disabled, \[class\*=" text-"\]\) \.v-list-item-subtitle \{\s*color: rgb\(var\(--v-theme-on-surface-variant\)\);\s*opacity: 1;/u
  );
  // A disabled container button is on-surface 12% and 38%, unlayered over its colour class.
  assert.match(
    css,
    /^\.v-btn--disabled:is\(\.v-btn--variant-flat, \.v-btn--variant-elevated, \.v-btn--variant-tonal\) \{\s*background-color: rgba\(var\(--v-theme-on-surface\), 0\.12\);/mu
  );
  // The touch target unclips buttons, so their state layer, underlay and ripple keep the button's corners themselves.
  assert.match(
    css,
    /\.v-btn > \.v-btn__overlay,\s*\.v-btn > \.v-btn__underlay,\s*\.v-btn > \.v-ripple__container,\s*\.v-chip > \.v-chip__overlay,\s*\.v-chip > \.v-chip__underlay,\s*\.v-chip > \.v-ripple__container \{\s*border-radius: inherit;/u
  );
});
