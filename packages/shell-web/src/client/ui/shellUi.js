import { inject } from "vue";

const SHELL_UI_KEY = "jskit.shell-web.ui.client";
// The kit's roles: the button and the dialog a JSKIT view draws, and the classes of its text.
const SHELL_UI_ROLES = Object.freeze(["Button", "Dialog", "text"]);
// A view's text by what it is: a page's title (its h1), a heading and a subheading inside a page or a dialog, a short
// emphasized line, lead text, body text and a caption.
const SHELL_UI_TEXT_ROLES = Object.freeze(["title", "heading", "subheading", "strong", "lead", "body", "caption"]);
// Material 3's type scale for each text role, as Vuetify's classes: what a JSKIT view drew before the kit.
const MATERIAL_TEXT = Object.freeze({
  title: "text-headline-medium",
  heading: "text-title-large",
  subheading: "text-title-medium",
  strong: "text-title-small",
  lead: "text-body-large",
  body: "text-body-medium",
  caption: "text-body-small"
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shown(value) {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function component(role, value) {
  if (typeof value !== "function" && !isRecord(value)) {
    throw new TypeError(`Shell UI role "${role}" needs a Vue component, not ${shown(value)}.`);
  }
  return value;
}

function textClasses(text) {
  if (!isRecord(text)) {
    throw new TypeError('Shell UI role "text" needs an object of class names by text role.');
  }
  for (const [role, value] of Object.entries(text)) {
    if (!SHELL_UI_TEXT_ROLES.includes(role)) {
      throw new TypeError(`Shell UI text role "${role}" is not one of ${SHELL_UI_TEXT_ROLES.join(", ")}.`);
    }
    if (typeof value !== "string") {
      throw new TypeError(`Shell UI text role "${role}" needs a class name, not ${shown(value)}.`);
    }
  }
  return text;
}

/**
 * The kit a view reads: the application's roles where it gave them, the defaults for the rest, each checked.
 * @param {unknown} kit
 * @param {import("../types.js").ShellUi} defaults
 * @returns {import("../types.js").ShellUi}
 */
function resolveShellUi(kit, defaults) {
  if (kit === undefined) {
    return defaults;
  }
  if (!isRecord(kit)) {
    throw new TypeError("provideShellUi needs a kit object: { Button, Dialog, text }, each optional.");
  }
  for (const role of Object.keys(kit)) {
    if (!SHELL_UI_ROLES.includes(role)) {
      throw new TypeError(`Shell UI role "${role}" is not one of ${SHELL_UI_ROLES.join(", ")}.`);
    }
  }
  return Object.freeze({
    Button: Object.hasOwn(kit, "Button") ? component("Button", kit.Button) : defaults.Button,
    Dialog: Object.hasOwn(kit, "Dialog") ? component("Dialog", kit.Dialog) : defaults.Dialog,
    text: Object.freeze({ ...defaults.text, ...(Object.hasOwn(kit, "text") ? textClasses(kit.text) : {}) })
  });
}

/**
 * The kit's two functions over its defaults: `provideShellUi(vueApp, kit)`, which an application calls once, before it
 * mounts, with the roles it draws in its own design system, and `useShellUi()`, which a view calls in its setup.
 * @param {import("../types.js").ShellUi} defaults
 */
function defineShellUi(defaults) {
  return Object.freeze({
    /**
     * @param {{ provide: (key: string, value: unknown) => unknown }} vueApp
     * @param {Partial<import("../types.js").ShellUi>} [kit]
     */
    provideShellUi(vueApp, kit) {
      vueApp.provide(SHELL_UI_KEY, resolveShellUi(kit, defaults));
    },
    /** @returns {import("../types.js").ShellUi} */
    useShellUi() {
      return inject(SHELL_UI_KEY, defaults);
    }
  });
}

// What the kit's own Material components read where the application provided no kit: Material's text classes.
const MATERIAL_TEXT_ONLY = Object.freeze({ text: MATERIAL_TEXT });

/**
 * The text classes the application provided, or Material's, for the kit's own Material components.
 * @returns {Readonly<Record<string, string>>}
 */
function useShellUiText() {
  return inject(SHELL_UI_KEY, MATERIAL_TEXT_ONLY).text;
}

export { MATERIAL_TEXT, SHELL_UI_KEY, SHELL_UI_ROLES, SHELL_UI_TEXT_ROLES, defineShellUi, resolveShellUi, useShellUiText };
