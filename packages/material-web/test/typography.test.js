import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "../src/client/index.js";

const ROBOTO_FLEX = '"Roboto Flex Variable", "Roboto Flex", Roboto, system-ui, sans-serif';

test("both Material 3 typefaces default to Roboto Flex in the light and dark themes", () => {
  const { themes } = createMaterialVuetifyOptions().theme;
  for (const theme of [themes.light, themes.dark]) {
    assert.equal(theme.variables["font-heading"], ROBOTO_FLEX);
    assert.equal(theme.variables["font-body"], ROBOTO_FLEX);
    assert.equal(theme.variables["hover-opacity"], 0.08, "the state layers stay beside them");
  }
});

test("typography sets the brand typeface for Vuetify's heading roles and the plain one for the rest", () => {
  const options = createMaterialVuetifyOptions({ typography: { brand: '"Fraunces", serif', plain: '"Inter", sans-serif' } });
  assert.equal(options.theme.themes.light.variables["font-heading"], '"Fraunces", serif');
  assert.equal(options.theme.themes.dark.variables["font-body"], '"Inter", sans-serif');
  // One typeface given: the other stays Roboto Flex.
  const brandOnly = createMaterialVuetifyOptions({ typography: { brand: "Fraunces" } }).theme.themes.light.variables;
  assert.deepEqual([brandOnly["font-heading"], brandOnly["font-body"]], ["Fraunces", ROBOTO_FLEX]);
  // Vuetify writes them as --v-font-heading and --v-font-body, which its type classes read, on :root and each theme.
  const styles = createVuetify(options).theme.styles.value;
  assert.match(styles, /:root \{[^}]*--v-font-heading: "Fraunces", serif;[^}]*--v-font-body: "Inter", sans-serif;/u);
  assert.match(styles, /\.v-theme--dark \{[^}]*--v-font-heading: "Fraunces", serif;/u);
});

test("a typeface that isn't a CSS font-family value is refused", () => {
  assert.throws(() => createMaterialVuetifyOptions({ typography: { brand: " " } }), /typography\.brand needs a CSS font-family value/u);
  assert.throws(() => createMaterialVuetifyOptions({ typography: { plain: "Inter; color: red" } }), /typography\.plain/u);
});

test("material.css declares Roboto Flex for both typefaces only as a fallback below the theme's", async () => {
  const css = await readFile(new URL("../src/client/material.css", import.meta.url), "utf8");
  const fallback = /@layer vuetify-core \{\s*:root \{([^}]*)\}\s*\}/u.exec(css);
  assert.ok(fallback, "the fallback sits in the vuetify-core layer");
  assert.match(fallback[1], /--v-font-heading: "Roboto Flex Variable"/u);
  assert.match(fallback[1], /--v-font-body: "Roboto Flex Variable"/u);
  assert.equal((css.match(/--v-font-(?:heading|body)\s*:/gu) || []).length, 2, "no unlayered rule outranks the theme's typefaces");
});
