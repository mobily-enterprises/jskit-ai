#!/usr/bin/env node
// Writes src/client/symbols.js: the Material Symbols Rounded glyphs JSKIT's icon aliases name, as Vuetify "svg:" paths.
// The glyphs come from @iconify-json/material-symbols (Google's Material Symbols, Apache-2.0, on a 24x24 grid).
// Each alias takes the outlined glyph (Material Symbols' default, FILL 0) unless it asks for the filled one; an alias
// listed in FILLED_VARIANTS also gets a `<name>Filled` alias, which the shell uses for the active navigation item.
// Run: node packages/material-web/scripts/generate-symbols.mjs [--check]
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(PACKAGE_ROOT, "src/client/symbols.js");

// Vuetify's own aliases, every one of them, so no component falls back to an icon font.
const VUETIFY_ALIASES = Object.freeze({
  collapse: "keyboard-arrow-up",
  complete: "check",
  cancel: { symbol: "cancel", fill: true },
  close: "close",
  delete: "delete",
  clear: { symbol: "cancel", fill: true },
  success: "check-circle",
  info: "info",
  warning: "warning",
  error: "error",
  prev: "chevron-left",
  next: "chevron-right",
  checkboxOn: { symbol: "check-box", fill: true },
  checkboxOff: "check-box-outline-blank",
  checkboxIndeterminate: { symbol: "indeterminate-check-box", fill: true },
  delimiter: { symbol: "circle", fill: true },
  sortAsc: "arrow-upward",
  sortDesc: "arrow-downward",
  expand: "keyboard-arrow-down",
  menu: "menu",
  subgroup: "arrow-drop-down",
  dropdown: "arrow-drop-down",
  radioOn: "radio-button-checked",
  radioOff: "radio-button-unchecked",
  edit: "edit",
  ratingEmpty: "star",
  ratingFull: { symbol: "star", fill: true },
  ratingHalf: "star-half",
  loading: "cached",
  first: "first-page",
  last: "last-page",
  unfold: "unfold-more",
  file: "attach-file",
  plus: "add",
  minus: "remove",
  calendar: "calendar-today",
  clock: "schedule",
  treeviewCollapse: "arrow-drop-down",
  treeviewExpand: "arrow-right",
  tableGroupCollapse: "keyboard-arrow-down",
  tableGroupExpand: "keyboard-arrow-right",
  eyeDropper: "colorize",
  upload: "cloud-upload",
  color: "palette",
  command: "keyboard-command-key",
  ctrl: "keyboard-control-key",
  space: "space-bar",
  shift: "shift",
  alt: "keyboard-option-key",
  enter: "keyboard-return",
  arrowup: "arrow-upward",
  arrowdown: "arrow-downward",
  arrowleft: "arrow-back",
  arrowright: "arrow-forward",
  backspace: "backspace",
  play: "play-arrow",
  pause: "pause",
  fullscreen: "fullscreen",
  fullscreenExit: "fullscreen-exit",
  volumeHigh: "volume-up",
  volumeMedium: "volume-down",
  volumeLow: "volume-mute",
  volumeOff: "volume-off",
  search: "search"
});

// The icons JSKIT's screens use, named after the symbol in camelCase.
const JSKIT_ALIASES = Object.freeze({
  accountCircle: "account-circle",
  add: "add",
  adminPanelSettings: "admin-panel-settings",
  apps: "apps",
  arrowBack: "arrow-back",
  arrowCircleRight: "arrow-circle-right",
  arrowForward: "arrow-forward",
  assignment: "assignment",
  attachFile: "attach-file",
  cached: "cached",
  calendarToday: "calendar-today",
  chat: "chat",
  check: "check",
  checkCircle: "check-circle",
  chevronLeft: "chevron-left",
  chevronRight: "chevron-right",
  cloudDone: "cloud-done",
  cloudOff: "cloud-off",
  contentCopy: "content-copy",
  dashboard: "dashboard",
  description: "description",
  download: "download",
  event: "event",
  filterList: "filter-list",
  folder: "folder",
  group: "group",
  headsetMic: "headset-mic",
  help: "help",
  history: "history",
  home: "home",
  image: "image",
  inbox: "inbox",
  key: "key",
  lightbulb: "lightbulb",
  link: "link",
  lock: "lock",
  login: "login",
  logout: "logout",
  mail: "mail",
  manageAccounts: "manage-accounts",
  markEmailUnread: "mark-email-unread",
  menuOpen: "menu-open",
  mic: "mic",
  micOff: "mic-off",
  moreVert: "more-vert",
  notifications: "notifications",
  openInNew: "open-in-new",
  payments: "payments",
  person: "person",
  psychology: "psychology",
  receiptLong: "receipt-long",
  refresh: "refresh",
  remove: "remove",
  save: "save",
  schedule: "schedule",
  searchOff: "search-off",
  send: "send",
  settings: "settings",
  smartToy: "smart-toy",
  sort: "sort",
  stop: "stop",
  stopCircle: "stop-circle",
  swapHoriz: "swap-horiz",
  sync: "sync",
  terminal: "terminal",
  translate: "translate",
  tune: "tune",
  viewList: "view-list",
  visibility: "visibility",
  visibilityOff: "visibility-off",
  volumeUp: "volume-up",
  work: "work"
});

// Navigation destinations show the filled glyph while active.
const FILLED_VARIANTS = Object.freeze([
  "accountCircle",
  "adminPanelSettings",
  "assignment",
  "chat",
  "dashboard",
  "description",
  "folder",
  "group",
  "home",
  "manageAccounts",
  "person",
  "settings",
  "smartToy",
  "viewList",
  "work"
]);

// Material Symbols has no brand marks. The Google "G" for Google sign-in is Simple Icons' google.svg (CC0-1.0).
const BRAND_ALIASES = Object.freeze({
  google:
    "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
});

const PATH_BODY = /^<path fill="currentColor" d="([^"]+)"\/>$/u;

function resolveIcon(iconSet, name) {
  const seen = new Set();
  let current = name;
  while (!iconSet.icons[current]) {
    const alias = iconSet.aliases?.[current];
    if (!alias || seen.has(current)) {
      return null;
    }
    const transforms = Object.keys(alias).filter((key) => key !== "parent");
    if (transforms.length > 0) {
      throw new Error(`Material Symbols alias "${name}" transforms its parent (${transforms.join(", ")}); pick another glyph.`);
    }
    seen.add(current);
    current = alias.parent;
  }
  const icon = iconSet.icons[current];
  if (icon.width || icon.height || icon.left || icon.top || icon.rotate || icon.hFlip || icon.vFlip) {
    throw new Error(`Material Symbols glyph "${current}" is not on the plain 24x24 grid.`);
  }
  const match = PATH_BODY.exec(icon.body);
  if (!match) {
    throw new Error(`Material Symbols glyph "${current}" is not a single path.`);
  }
  return match[1];
}

function resolveGlyph(iconSet, spec) {
  const { symbol, fill = false } = typeof spec === "string" ? { symbol: spec } : spec;
  const candidates = fill ? [`${symbol}-rounded`] : [`${symbol}-outline-rounded`, `${symbol}-rounded`];
  for (const candidate of candidates) {
    const glyph = resolveIcon(iconSet, candidate);
    if (glyph) {
      return glyph;
    }
  }
  throw new Error(`Material Symbols Rounded has no "${symbol}".`);
}

function buildSymbols(iconSet) {
  const symbols = {};
  for (const [alias, spec] of Object.entries({ ...VUETIFY_ALIASES, ...JSKIT_ALIASES })) {
    symbols[alias] = resolveGlyph(iconSet, spec);
  }
  for (const alias of FILLED_VARIANTS) {
    const spec = JSKIT_ALIASES[alias];
    if (!spec) {
      throw new Error(`Filled variant "${alias}" has no JSKIT alias.`);
    }
    symbols[`${alias}Filled`] = resolveGlyph(iconSet, { symbol: spec, fill: true });
  }
  Object.assign(symbols, BRAND_ALIASES);
  return Object.fromEntries(Object.entries(symbols).sort(([left], [right]) => left.localeCompare(right)));
}

async function buildSymbolsSource() {
  const require = createRequire(import.meta.url);
  const iconSetPath = require.resolve("@iconify-json/material-symbols/icons.json");
  const iconSetPackage = JSON.parse(
    await readFile(path.join(path.dirname(iconSetPath), "package.json"), "utf8")
  );
  const iconSet = JSON.parse(await readFile(iconSetPath, "utf8"));
  const symbols = buildSymbols(iconSet);
  const lines = Object.entries(symbols).map(([alias, glyph]) => `  ${alias}: "svg:${glyph}"`);
  return [
    "// Generated by packages/material-web/scripts/generate-symbols.mjs; do not edit.",
    `// Material Symbols Rounded (Apache-2.0) from @iconify-json/material-symbols ${iconSetPackage.version};`,
    "// the google mark is Simple Icons' google.svg (CC0-1.0).",
    "",
    "/** Every icon alias JSKIT defines, as Vuetify svg paths on a 24x24 grid. */",
    "const materialSymbols = Object.freeze({",
    lines.join(",\n"),
    "});",
    "",
    "/** The Vuetify aliases JSKIT replaces, so no component falls back to an icon font. */",
    `const vuetifyAliasNames = Object.freeze(${JSON.stringify(Object.keys(VUETIFY_ALIASES))});`,
    "",
    "export { materialSymbols, vuetifyAliasNames };",
    ""
  ].join("\n");
}

async function main() {
  const source = await buildSymbolsSource();
  if (process.argv.includes("--check")) {
    const current = await readFile(OUTPUT_PATH, "utf8");
    if (current !== source) {
      console.error("src/client/symbols.js is out of date; run node packages/material-web/scripts/generate-symbols.mjs");
      process.exitCode = 1;
    }
    return;
  }
  await writeFile(OUTPUT_PATH, source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { buildSymbolsSource };
