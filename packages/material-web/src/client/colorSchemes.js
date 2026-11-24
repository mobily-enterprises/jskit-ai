import {
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  argbFromHex,
  customColor,
  hexFromArgb,
  redFromArgb,
  greenFromArgb,
  blueFromArgb
} from "@material/material-color-utilities";

// The Material 3 colour roles, by their Material Color Utilities names. The palette key colours are inputs, not roles.
const ROLE_NAMES = Object.freeze([
  "background",
  "onBackground",
  "surface",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "inverseSurface",
  "inverseOnSurface",
  "outline",
  "outlineVariant",
  "shadow",
  "scrim",
  "surfaceTint",
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "primaryFixed",
  "primaryFixedDim",
  "onPrimaryFixed",
  "onPrimaryFixedVariant",
  "secondaryFixed",
  "secondaryFixedDim",
  "onSecondaryFixed",
  "onSecondaryFixedVariant",
  "tertiaryFixed",
  "tertiaryFixedDim",
  "onTertiaryFixed",
  "onTertiaryFixedVariant"
]);

// Status colours Material 3 leaves to the app, as HCT hues harmonized toward the seed (customColor with blend), so a
// success, warning or info colour sits in the seed's family the way Material Theme Builder's custom colours do.
const STATUS_COLOR_HCT = Object.freeze({
  success: Object.freeze({
    hue: 145,
    chroma: 48,
    tone: 40
  }),
  warning: Object.freeze({
    hue: 70,
    chroma: 60,
    tone: 60
  }),
  info: Object.freeze({
    hue: 250,
    chroma: 48,
    tone: 40
  })
});

// Material 3 state layers (hover 8%, focus 10%, pressed 10%, dragged 16%); Vuetify's other opacities follow them.
const STATE_LAYER_VARIABLES = Object.freeze({
  "hover-opacity": 0.08,
  "focus-opacity": 0.1,
  "pressed-opacity": 0.1,
  "dragged-opacity": 0.16,
  "selected-opacity": 0.08,
  "activated-opacity": 0.1,
  "idle-opacity": 0,
  "disabled-opacity": 0.38,
  "high-emphasis-opacity": 1,
  "border-opacity": 1,
  // Material 3 elevation is a shadow only; the surface-container roles carry the tone, so no tint overlay.
  "elevation-overlay-opacity-step": "0%"
});

const SURFACE_TONES = Object.freeze([
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-light"
]);

// Vuetify-only names, each the Material 3 role it takes.
const VUETIFY_ROLE_NAMES = Object.freeze({
  // Vuetify paints fields, alerts, toolbars and timelines with surface-light; Material 3 uses the highest container.
  "surface-light": "surface-container-highest",
  // Content on every surface tone is on-surface in Material 3; Vuetify would otherwise pick black or white for a
  // bg-surface-container-* or bg-surface-dim/bright element.
  ...Object.fromEntries(SURFACE_TONES.map((surface) => [`on-${surface}`, "on-surface"])),
  "primary-darken-1": "on-primary-container",
  "secondary-darken-1": "on-secondary-container"
});

/**
 * The revision of the colours a theme input gives. A browser keeps the colours it computed for an input under this
 * revision and its later starts reuse them, so bump it whenever the same input gives other colours (a role added or
 * remapped, a status colour moved, another Material Color Utilities): every browser then computes them again.
 * materialWeb.test.js holds the colours of each revision, read from what a browser stores, and fails when they change
 * without it.
 */
const THEMES_REVISION = 1;
// The browser storage item that keeps the colours of the inputs computed last, newest first.
const STORAGE_ITEM = "jskit:material-themes";
const STORED_INPUTS = 4;
// How many inputs' colours one page or process keeps, for an app that calls with many (a seed picker, say).
const REMEMBERED_INPUTS = 16;
const HEX = /^#[0-9a-f]{6}$/u;
const ROLE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function kebabCase(name) {
  return name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function channels(argb) {
  return `${redFromArgb(argb)}, ${greenFromArgb(argb)}, ${blueFromArgb(argb)}`;
}

/**
 * A custom colour's four roles, as Material Theme Builder names them: the colour, on it, its container and on the
 * container.
 * @param {string} name A camelCase colour name.
 */
function customColorRoleNames(name) {
  const role = kebabCase(name);
  return [role, `on-${role}`, `${role}-container`, `on-${role}-container`];
}

// Every role a scheme has before the app's own colours: an app colour may not take one of their names.
const SCHEME_ROLE_NAMES = new Set([
  ...ROLE_NAMES.map(kebabCase),
  ...Object.keys(STATUS_COLOR_HCT).flatMap(customColorRoleNames),
  ...Object.keys(VUETIFY_ROLE_NAMES)
]);

/**
 * Adds a colour's four roles to the light and the dark scheme, from one customColor (which gives both): harmonized
 * toward the seed unless `blend` is false, as Material Theme Builder's per-colour Blend toggle does.
 * @param {{ light: Record<string, number>, dark: Record<string, number> }} schemes
 * @param {number} seedArgb
 * @param {string} name
 * @param {number} argb
 * @param {boolean} [blend]
 */
function addCustomColorRoles(schemes, seedArgb, name, argb, blend = true) {
  const custom = customColor(seedArgb, { name, value: argb, blend });
  const [role, onRole, containerRole, onContainerRole] = customColorRoleNames(name);
  for (const [roles, tones] of [[schemes.light, custom.light], [schemes.dark, custom.dark]]) {
    roles[role] = tones.color;
    roles[onRole] = tones.onColor;
    roles[containerRole] = tones.colorContainer;
    roles[onContainerRole] = tones.onColorContainer;
  }
}

/**
 * Every Material 3 role of one scheme in kebab-case.
 * @param {number} seedArgb
 * @param {boolean} dark
 */
function materialRoles(seedArgb, dark) {
  const scheme = new SchemeTonalSpot(Hct.fromInt(seedArgb), dark, 0);
  return Object.fromEntries(ROLE_NAMES.map((name) => [kebabCase(name), MaterialDynamicColors[name].getArgb(scheme)]));
}

/**
 * Both schemes' colours as hex: every Material 3 role in kebab-case, the status colours and the app's own colours
 * with their containers, and the Vuetify-only names mapped onto Material 3 roles. This is the Material Color
 * Utilities work; each scheme and each custom colour is computed once.
 * @param {number} seedArgb
 * @param {Array<[string, number, boolean]>} appColors
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
function computeSchemeColors(seedArgb, appColors) {
  const schemes = { light: materialRoles(seedArgb, false), dark: materialRoles(seedArgb, true) };
  for (const [name, { hue, chroma, tone }] of Object.entries(STATUS_COLOR_HCT)) {
    addCustomColorRoles(schemes, seedArgb, name, Hct.from(hue, chroma, tone).toInt());
  }
  for (const roles of Object.values(schemes)) {
    for (const [name, role] of Object.entries(VUETIFY_ROLE_NAMES)) {
      roles[name] = roles[role];
    }
  }
  for (const [name, argb, blend] of appColors) {
    addCustomColorRoles(schemes, seedArgb, name, argb, blend);
  }
  const hex = (roles) => Object.fromEntries(Object.entries(roles).map(([name, value]) => [name, hexFromArgb(value)]));
  return { light: hex(schemes.light), dark: hex(schemes.dark) };
}

/** A scheme's colours as a page reads them back from storage: kebab-case names, hex values and every scheme role. */
function storedColorsAreUsable(colors) {
  return Boolean(
    colors && typeof colors === "object" && !Array.isArray(colors) &&
    Object.entries(colors).every(([name, value]) => ROLE_NAME.test(name) && HEX.test(value)) &&
    [...SCHEME_ROLE_NAMES].every((name) => HEX.test(colors[name]))
  );
}

/** This page's storage when it runs in a browser and may use it; null on a server or when the browser refuses it. */
function browserStorage() {
  try {
    return typeof window === "object" && window?.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The inputs' colours earlier starts stored, newest first, as `[input, { light, dark }]`: none when storage holds
 * another revision's, cannot be read or is not what this module wrote.
 * @param {Storage} storage
 */
function storedSchemeColors(storage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_ITEM) || "null");
    if (stored?.revision !== THEMES_REVISION || !Array.isArray(stored.inputs)) {
      return [];
    }
    return stored.inputs
      .filter((entry) => typeof entry?.input === "string" && storedColorsAreUsable(entry.light) &&
        storedColorsAreUsable(entry.dark))
      .slice(0, STORED_INPUTS)
      .map(({ input, light, dark }) => [input, { light, dark }]);
  } catch {
    return [];
  }
}

// The colours this page or process has, by input, oldest first: a memo of computed and stored colours.
const rememberedSchemeColors = new Map();

function remember(input, colors) {
  rememberedSchemeColors.delete(input);
  rememberedSchemeColors.set(input, colors);
  for (const oldest of [...rememberedSchemeColors.keys()].slice(0, -REMEMBERED_INPUTS)) {
    rememberedSchemeColors.delete(oldest);
  }
}

/**
 * The colours of one theme input: the ones this page or process has, or an earlier start in this browser stored,
 * and otherwise computed once and stored for the next start. A changed seed or colour is another input.
 * @param {string} input
 * @param {number} seedArgb
 * @param {Array<[string, number, boolean]>} appColors
 */
function schemeColors(input, seedArgb, appColors) {
  const remembered = rememberedSchemeColors.get(input);
  if (remembered) {
    return remembered;
  }
  const storage = browserStorage();
  const stored = storage ? storedSchemeColors(storage) : [];
  // The stored colours of this input, when they also hold every role of the app's own colours.
  const appRoles = appColors.flatMap(([name]) => customColorRoleNames(name));
  const reused = stored.find(([storedInput, { light, dark }]) => storedInput === input &&
    appRoles.every((role) => HEX.test(light[role]) && HEX.test(dark[role])))?.[1];
  const colors = reused || computeSchemeColors(seedArgb, appColors);
  remember(input, colors);
  if (storage && !reused) {
    try {
      storage.setItem(STORAGE_ITEM, JSON.stringify({
        revision: THEMES_REVISION,
        inputs: [[input, colors], ...stored.filter(([storedInput]) => storedInput !== input)].slice(0, STORED_INPUTS)
          .map(([storedInput, { light, dark }]) => ({ input: storedInput, light, dark }))
      }));
    } catch {
      // Full or refused storage: the next start computes the colours again.
    }
  }
  return colors;
}

/**
 * One Vuetify theme from one scheme's colours, its own objects each time.
 * @param {Record<string, string>} schemeColorsByRole
 * @param {boolean} dark
 */
function vuetifyTheme(schemeColorsByRole, dark) {
  const colors = { ...schemeColorsByRole };
  return {
    dark,
    colors,
    variables: {
      ...STATE_LAYER_VARIABLES,
      // Channel strings: Vuetify writes them as rgba(var(--v-border-color), var(--v-border-opacity)).
      "border-color": channels(argbFromHex(colors["outline-variant"])),
      "shadow-color": channels(argbFromHex(colors.shadow)),
      "theme-kbd": colors["surface-container-highest"],
      "theme-on-kbd": colors["on-surface"],
      "theme-code": colors["surface-container"],
      "theme-on-code": colors["on-surface"],
      // The text Vuetify puts on a colour that has no on- role: the light or the dark end of the neutral palette.
      "theme-on-dark": dark ? colors["on-surface"] : colors.surface,
      "theme-on-light": dark ? colors.surface : colors["on-surface"]
    }
  };
}

/**
 * The app's own colours, such as a brand or partner colour, checked: camelCase names whose roles are not already
 * scheme roles, and each a six-digit hex value (harmonized toward the seed) or `{ value, blend }`, where
 * `blend: false` keeps the colour's own hue.
 * @param {Record<string, string | { value: string, blend?: boolean }>} colors
 * @returns {Array<[string, number, boolean]>}
 */
function normalizeAppColors(colors) {
  return Object.entries(colors).map(([name, value]) => {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name)) {
      throw new TypeError(`Theme colour "${name}" needs a camelCase name, such as "partner" or "brandAccent".`);
    }
    const clash = customColorRoleNames(name).find((role) => SCHEME_ROLE_NAMES.has(role));
    if (clash) {
      throw new TypeError(`Theme colour "${name}" would replace the scheme's "${clash}" role; choose another name.`);
    }
    const entry = value !== null && typeof value === "object" ? value : { value };
    const hex = String(entry.value || "").trim();
    if (!/^#[0-9a-f]{6}$/iu.test(hex)) {
      throw new TypeError(`Theme colour "${name}" must be a six-digit hex colour, not "${hex}".`);
    }
    const blend = entry.blend ?? true;
    if (typeof blend !== "boolean") {
      throw new TypeError(`Theme colour "${name}" takes blend: true or false, not ${JSON.stringify(blend)}.`);
    }
    return [name, argbFromHex(hex), blend];
  });
}

/**
 * The light and dark Material 3 schemes generated from one seed colour with Material Color Utilities
 * (SchemeTonalSpot, the Material 3 default), as Vuetify themes named light and dark. Each of the app's own colours
 * adds four roles in both schemes, harmonized toward the seed as Material Theme Builder's custom colours are:
 * `partner: "#0A7D3E"` gives partner, on-partner, partner-container and on-partner-container. A brand or partner
 * colour that must keep its hue is `{ value: "#F5C518", blend: false }`, Theme Builder's Blend switched off. The colours
 * of one input are computed once: a page or process reuses them, and a browser keeps the last few inputs' colours for
 * its later starts (see THEMES_REVISION); a changed seed or colour computes them again.
 * @param {string} seed A hex colour such as "#6750A4".
 * @param {Record<string, string | { value: string, blend?: boolean }>} [colors] The app's own colours by camelCase
 * name: hex colours, or `{ value, blend }`.
 */
function materialThemes(seed, colors = {}) {
  const normalizedSeed = String(seed || "").trim();
  if (!/^#[0-9a-f]{6}$/iu.test(normalizedSeed)) {
    throw new TypeError(`The Material theme seed must be a six-digit hex colour, not "${normalizedSeed}".`);
  }
  const appColors = normalizeAppColors(colors);
  const input = JSON.stringify([normalizedSeed.toLowerCase(), appColors]);
  const { light, dark } = schemeColors(input, argbFromHex(normalizedSeed), appColors);
  return {
    light: vuetifyTheme(light, false),
    dark: vuetifyTheme(dark, true)
  };
}

export { materialThemes };
