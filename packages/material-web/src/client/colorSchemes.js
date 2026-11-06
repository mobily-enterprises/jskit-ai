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

/**
 * Adds a colour's four roles, from customColor: harmonized toward the seed unless `blend` is false, as Material Theme
 * Builder's per-colour Blend toggle does.
 * @param {Record<string, number>} roles
 * @param {number} seedArgb
 * @param {boolean} dark
 * @param {string} name
 * @param {number} argb
 * @param {boolean} [blend]
 */
function addCustomColorRoles(roles, seedArgb, dark, name, argb, blend = true) {
  const custom = customColor(seedArgb, { name, value: argb, blend });
  const tones = dark ? custom.dark : custom.light;
  const [role, onRole, containerRole, onContainerRole] = customColorRoleNames(name);
  roles[role] = tones.color;
  roles[onRole] = tones.onColor;
  roles[containerRole] = tones.colorContainer;
  roles[onContainerRole] = tones.onColorContainer;
}

/**
 * One scheme's colours: every Material 3 role in kebab-case, the status colours and the app's own colours with their
 * containers, and the Vuetify-only names mapped onto Material 3 roles.
 * @param {SchemeTonalSpot} scheme
 * @param {number} seedArgb
 * @param {boolean} dark
 * @param {Array<[string, number, boolean]>} appColors
 */
function schemeColors(scheme, seedArgb, dark, appColors) {
  const roles = {};
  for (const name of ROLE_NAMES) {
    roles[kebabCase(name)] = MaterialDynamicColors[name].getArgb(scheme);
  }
  for (const [name, { hue, chroma, tone }] of Object.entries(STATUS_COLOR_HCT)) {
    addCustomColorRoles(roles, seedArgb, dark, name, Hct.from(hue, chroma, tone).toInt());
  }
  // Vuetify paints fields, alerts, toolbars and timelines with surface-light; Material 3 uses the highest container.
  roles["surface-light"] = roles["surface-container-highest"];
  // Content on every surface tone is on-surface in Material 3; Vuetify would otherwise pick black or white for a
  // bg-surface-container-* or bg-surface-dim/bright element.
  for (const surface of SURFACE_TONES) {
    roles[`on-${surface}`] = roles["on-surface"];
  }
  roles["primary-darken-1"] = roles["on-primary-container"];
  roles["secondary-darken-1"] = roles["on-secondary-container"];
  for (const [name, argb, blend] of appColors) {
    addCustomColorRoles(roles, seedArgb, dark, name, argb, blend);
  }
  return roles;
}

/**
 * One Vuetify theme from one Material 3 scheme.
 * @param {number} seedArgb
 * @param {boolean} dark
 * @param {Array<[string, number, boolean]>} appColors
 */
function vuetifyTheme(seedArgb, dark, appColors) {
  const scheme = new SchemeTonalSpot(Hct.fromInt(seedArgb), dark, 0);
  const roles = schemeColors(scheme, seedArgb, dark, appColors);
  const colors = Object.fromEntries(Object.entries(roles).map(([name, argb]) => [name, hexFromArgb(argb)]));
  return {
    dark,
    colors,
    variables: {
      ...STATE_LAYER_VARIABLES,
      // Channel strings: Vuetify writes them as rgba(var(--v-border-color), var(--v-border-opacity)).
      "border-color": channels(roles["outline-variant"]),
      "shadow-color": channels(roles.shadow),
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
 * @param {Set<string>} schemeRoles
 * @returns {Array<[string, number, boolean]>}
 */
function normalizeAppColors(colors, schemeRoles) {
  return Object.entries(colors).map(([name, value]) => {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name)) {
      throw new TypeError(`Theme colour "${name}" needs a camelCase name, such as "partner" or "brandAccent".`);
    }
    const clash = customColorRoleNames(name).find((role) => schemeRoles.has(role));
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
 * colour that must keep its hue is `{ value: "#F5C518", blend: false }`, Theme Builder's Blend switched off.
 * @param {string} seed A hex colour such as "#6750A4".
 * @param {Record<string, string | { value: string, blend?: boolean }>} [colors] The app's own colours by camelCase
 * name: hex colours, or `{ value, blend }`.
 */
function materialThemes(seed, colors = {}) {
  const normalizedSeed = String(seed || "").trim();
  if (!/^#[0-9a-f]{6}$/iu.test(normalizedSeed)) {
    throw new TypeError(`The Material theme seed must be a six-digit hex colour, not "${normalizedSeed}".`);
  }
  const seedArgb = argbFromHex(normalizedSeed);
  const schemeRoles = new Set(Object.keys(vuetifyTheme(seedArgb, false, []).colors));
  const appColors = normalizeAppColors(colors, schemeRoles);
  return {
    light: vuetifyTheme(seedArgb, false, appColors),
    dark: vuetifyTheme(seedArgb, true, appColors)
  };
}

export { materialThemes };
