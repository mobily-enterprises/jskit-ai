import { md3 } from "vuetify/blueprints";
import { materialThemes } from "./colorSchemes.js";
import { materialDefaults } from "./defaults.js";
import { endKeyboardRipplesWithThePress } from "./keyboardRipple.js";
import { materialSymbols } from "./symbols.js";

// The default Material 3 seed, the baseline purple of the Material 3 guidelines.
const DEFAULT_SEED = "#6750A4";
// Roboto Flex, Material 3's default for both typefaces (material.css loads it).
const ROBOTO_FLEX = '"Roboto Flex Variable", "Roboto Flex", Roboto, system-ui, sans-serif';
// The weights Material 3's type roles use: regular for display, headline, title-large and body; medium for the other
// titles and the labels.
const TYPE_ROLE_WEIGHTS = Object.freeze([400, 500]);

/**
 * Material 3's two typefaces as Vuetify theme variables: brand for display, headline and title-large (Vuetify's
 * heading font), plain for title-medium and -small, body and label (its body font). Each is a CSS font-family value.
 * @param {{ brand?: string, plain?: string }} typography
 */
function typefaceVariables({ brand = ROBOTO_FLEX, plain = ROBOTO_FLEX } = {}) {
  const family = (value, role) => {
    const text = String(value ?? "").trim();
    if (!text || /[;{}<>]/u.test(text)) {
      throw new TypeError(`Theme typography.${role} needs a CSS font-family value, such as '"Inter", sans-serif', not "${text}".`);
    }
    return text;
  };
  return { "font-heading": family(brand, "brand"), "font-body": family(plain, "plain") };
}

/**
 * Starts loading the theme's typefaces in a browser as the app boots, without waiting for them. A face is otherwise
 * fetched only when laid-out text first uses it, after the app mounts (a boot loader draws in system-ui), so the page
 * first showed in the fallback font and whatever was measured from text, such as the shell's content-fitted drawer,
 * changed when the face arrived. Started here it is usually in before the app mounts; a face that is slow or fails
 * leaves the fallback in place, as font-display: swap does.
 * @param {Window | undefined} view
 * @param {Record<string, string>} typefaces The theme's font variables, each a CSS font-family value.
 */
function startLoadingTypefaces(view, typefaces) {
  const fonts = view?.document?.fonts;
  if (!fonts) return;
  for (const family of new Set(Object.values(typefaces))) {
    for (const weight of TYPE_ROLE_WEIGHTS) {
      fonts.load(`${weight} 1em ${family}`).catch(() => undefined);
    }
  }
}

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
 * the app's own colours as harmonized custom colours), following the system's light or dark setting, the brand and
 * plain typefaces (Roboto Flex unless the app names its own), Material Symbols Rounded behind every icon alias (plus
 * the app's own), and JSKIT's Material 3 component defaults. Pass the result to createVuetify(); import
 * "@jskit-ai/material-web/client/material.css" after "vuetify/styles". In a browser it also makes a keyboard press's
 * ripple end with the press on a control whose own key handler moves focus away (keyboardRipple.js), once per window,
 * and starts loading the typefaces (startLoadingTypefaces), so they are usually in before the app mounts.
 * @param {{ seed?: string, colors?: Record<string, string | { value: string, blend?: boolean }>, icons?: Record<string, string>, typography?: { brand?: string, plain?: string } }} [theme]
 */
function createMaterialVuetifyOptions({ seed = DEFAULT_SEED, colors = {}, icons = {}, typography = {} } = {}) {
  const themes = materialThemes(seed, colors);
  const typefaces = typefaceVariables(typography);
  for (const theme of Object.values(themes)) {
    theme.variables = { ...theme.variables, ...typefaces };
  }
  const aliases = { ...materialSymbols, ...appIconAliases(icons) };
  endKeyboardRipplesWithThePress(globalThis.window);
  startLoadingTypefaces(globalThis.window, typefaces);
  return {
    blueprint: md3,
    defaults: materialDefaults,
    icons: {
      defaultSet: "svg",
      aliases
    },
    theme: {
      defaultTheme: "system",
      themes
    }
  };
}

export { materialThemes, createMaterialVuetifyOptions };
