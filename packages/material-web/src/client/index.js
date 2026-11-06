import { md3 } from "vuetify/blueprints";
import { materialThemes } from "./colorSchemes.js";
import { materialDefaults } from "./defaults.js";
import { materialSymbols } from "./symbols.js";

// The default Material 3 seed, the baseline purple of the Material 3 guidelines.
const DEFAULT_SEED = "#6750A4";

/**
 * An app's own icons as Vuetify aliases: `{ name: "<24x24 path data>" }` becomes `$name`.
 * @param {Record<string, string>} icons
 */
function appIconAliases(icons) {
  const aliases = {};
  for (const [name, path] of Object.entries(icons)) {
    const glyph = String(path || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name) || !glyph) {
      throw new TypeError(`Theme icon "${name}" needs a camelCase name and the icon's 24x24 SVG path data.`);
    }
    aliases[name] = glyph.startsWith("svg:") ? glyph : `svg:${glyph}`;
  }
  return aliases;
}

/**
 * Vuetify options for an exact Material 3 app: the md3 blueprint, light and dark schemes generated from the seed (with
 * the app's own colours as harmonized custom colours), following the system's light or dark setting, Material Symbols
 * Rounded behind every icon alias (plus the app's own), and JSKIT's Material 3 component defaults. Pass the result to
 * createVuetify(); import "@jskit-ai/material-web/client/material.css" after "vuetify/styles".
 * @param {{ seed?: string, colors?: Record<string, string>, icons?: Record<string, string> }} [theme]
 */
function createMaterialVuetifyOptions({ seed = DEFAULT_SEED, colors = {}, icons = {} } = {}) {
  return {
    blueprint: md3,
    defaults: materialDefaults,
    icons: {
      defaultSet: "svg",
      aliases: {
        ...materialSymbols,
        ...appIconAliases(icons)
      }
    },
    theme: {
      defaultTheme: "system",
      themes: materialThemes(seed, colors)
    }
  };
}

export { materialThemes, createMaterialVuetifyOptions };
