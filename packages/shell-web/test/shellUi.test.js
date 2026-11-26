import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { defineComponent } from "vue";
import {
  MATERIAL_TEXT,
  SHELL_UI_KEY,
  SHELL_UI_ROLES,
  SHELL_UI_TEXT_ROLES,
  defineShellUi
} from "../src/client/ui/shellUi.js";
import { mountComposable } from "./support/mountComposable.js";

// Stand-ins for the Material button and dialog, which are Vue files a unit test cannot import.
const MaterialButton = defineComponent({ name: "MaterialButton", render: () => null });
const MaterialDialog = defineComponent({ name: "MaterialDialog", render: () => null });
const { provideShellUi, useShellUi } = defineShellUi({ Button: MaterialButton, Dialog: MaterialDialog, text: MATERIAL_TEXT });

function withKit(kit) {
  return mountComposable(useShellUi, { plugins: [{ install: (app) => provideShellUi(app, kit) }] });
}

test("the kit's roles are a button, a dialog and seven text roles, whose Material classes are Material 3's type scale", () => {
  assert.deepEqual(SHELL_UI_ROLES, ["Button", "Dialog", "text"]);
  assert.deepEqual(SHELL_UI_TEXT_ROLES, ["title", "heading", "subheading", "strong", "lead", "body", "caption"]);
  assert.deepEqual(MATERIAL_TEXT, {
    title: "text-headline-medium",
    heading: "text-title-large",
    subheading: "text-title-medium",
    strong: "text-title-small",
    lead: "text-body-large",
    body: "text-body-medium",
    caption: "text-body-small"
  });
  assert.equal(SHELL_UI_KEY, "jskit.shell-web.ui.client");
});

test("an application that provides no kit gets the Material button, dialog and type classes", () => {
  const { app, result } = mountComposable(useShellUi);
  assert.equal(result.Button, MaterialButton);
  assert.equal(result.Dialog, MaterialDialog);
  assert.deepEqual(result.text, MATERIAL_TEXT);
  app.unmount();
});

test("a partial kit replaces only the roles it names, and a partial text map only its own text roles", () => {
  const AppButton = defineComponent({ name: "AppButton", render: () => null });
  const { app, result } = withKit({ Button: AppButton, text: { title: "app-title", body: "app-body" } });
  assert.equal(result.Button, AppButton);
  assert.equal(result.Dialog, MaterialDialog);
  assert.deepEqual(result.text, { ...MATERIAL_TEXT, title: "app-title", body: "app-body" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.text), true);
  app.unmount();
});

test("a functional component is a component, and an empty text class draws the role with no class", () => {
  const AppDialog = () => null;
  const { app, result } = withKit({ Dialog: AppDialog, text: { caption: "" } });
  assert.equal(result.Dialog, AppDialog);
  assert.equal(result.text.caption, "");
  app.unmount();
});

test("a kit with an unknown role, an unknown text role, a role that is not a component or a class that is not a string is refused", () => {
  const app = { provide: () => assert.fail("a refused kit is never provided") };
  assert.throws(() => provideShellUi(app, { Buton: MaterialButton }), /Shell UI role "Buton" is not one of Button, Dialog, text\./u);
  assert.throws(
    () => provideShellUi(app, { text: { headline: "x" } }),
    /Shell UI text role "headline" is not one of title, heading, subheading, strong, lead, body, caption\./u
  );
  assert.throws(() => provideShellUi(app, { Button: "AppButton" }), /Shell UI role "Button" needs a Vue component, not "AppButton"\./u);
  assert.throws(() => provideShellUi(app, { Dialog: null }), /Shell UI role "Dialog" needs a Vue component, not null\./u);
  assert.throws(() => provideShellUi(app, { text: { body: 14 } }), /Shell UI text role "body" needs a class name, not 14\./u);
  assert.throws(() => provideShellUi(app, { text: ["app-title"] }), /Shell UI role "text" needs an object of class names by text role\./u);
  assert.throws(() => provideShellUi(app, "kit"), /provideShellUi needs a kit object/u);
});

test("shell-web exports the kit at ./client/ui, with the Material button and dialog as its defaults", () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.equal(packageJson.exports["./client/ui"], "./src/client/ui/index.js");
  const index = readFileSync(fileURLToPath(new URL("../src/client/ui/index.js", import.meta.url)), "utf8");
  assert.match(index, /import ShellUiButton from "\.\/ShellUiButton\.vue";/u);
  assert.match(index, /import ShellUiDialog from "\.\/ShellUiDialog\.vue";/u);
  assert.match(index, /defineShellUi\(\{ Button: ShellUiButton, Dialog: ShellUiDialog, text: MATERIAL_TEXT \}\)/u);
  assert.match(index, /export \{[^}]*\bprovideShellUi\b[^}]*\buseShellUi\b[^}]*\}/u);
});

test("the Material button draws each emphasis and tone as the Vuetify button the auth screens drew before the kit", () => {
  const button = readFileSync(fileURLToPath(new URL("../src/client/ui/ShellUiButton.vue", import.meta.url)), "utf8");
  assert.match(button, /high: "flat"/u);
  assert.match(button, /medium: "tonal"/u);
  assert.match(button, /subtle: "outlined"/u);
  assert.match(button, /low: "text"/u);
  assert.match(button, /accent: "primary"/u);
  assert.match(button, /neutral: "secondary"/u);
  assert.match(button, /danger: "error"/u);
});
