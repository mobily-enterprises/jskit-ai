import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkMaterial3, formatMaterial3Report } from "../scripts/material3.mjs";

async function withApp(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-ui-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const findingLines = (result) => result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);
const component = (script, template) => `<script setup>\n${script}\n</script>\n<template>\n  ${template}\n</template>\n`;

const HTTP_WEB = {
  name: "@jskit-ai/http-web",
  version: "0.3.0",
  jskit: { metadata: { ui: { removedProps: { CrudViewScreen: { resourcePluralTitle: "The shell's Up arrow returns to the list." } } } } }
};

test("a prop the installed JSKIT package lists as removed from a component is a finding, however it is imported and written", async () => {
  await withApp({
    "package.json": { name: "removed-props", private: true },
    "node_modules/@jskit-ai/http-web/package.json": HTTP_WEB,
    "src/pages/books/view.vue": component(
      "import CrudViewScreen from \"@jskit-ai/http-web/client/components/CrudViewScreen\";",
      "<CrudViewScreen resource-plural-title=\"Books\" title=\"Book\" />"
    ),
    "src/pages/books/renamed.vue": component(
      "import { CrudListScreen, CrudViewScreen as BookView } from \"@jskit-ai/http-web/client\";",
      "<book-view :resourcePluralTitle=\"plural\" /><CrudListScreen resource-plural-title=\"Books\" />"
    ),
    // The app's own component of that name is not JSKIT's, and a prop JSKIT's still has passes.
    "src/pages/books/own.vue": component(
      "import CrudViewScreen from \"@/components/CrudViewScreen.vue\";",
      "<CrudViewScreen resource-plural-title=\"Books\" />"
    ),
    "src/pages/books/current.vue": component(
      "import CrudViewScreen from \"@jskit-ai/http-web/client/components/CrudViewScreen\";",
      "<CrudViewScreen title=\"Book\" />"
    )
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), ["src/pages/books/renamed.vue:5 ui/removed-prop", "src/pages/books/view.vue:5 ui/removed-prop"]);
    assert.equal(result.findings[0].message, "BookView (@jskit-ai/http-web) no longer has the prop resourcePluralTitle, so Vue passes it " +
      "on as an HTML attribute that does nothing. The shell's Up arrow returns to the list.");
    assert.match(formatMaterial3Report(result), /ui\/removed-prop {2}CrudViewScreen .*\n {2}https:\/\/\S+\/material-3#foundation\n/u);
  });
});

test("an exception cannot excuse a ui/* rule", async () => {
  await withApp({
    "package.json": { name: "removed-props", private: true },
    "node_modules/@jskit-ai/http-web/package.json": HTTP_WEB,
    "src/pages/books/view.vue": component(
      "import CrudViewScreen from \"@jskit-ai/http-web/client/components/CrudViewScreen\";",
      "<!-- m3-check: allow ui/removed-prop - kept for now -->\n  <CrudViewScreen resource-plural-title=\"Books\" />"
    )
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), ["src/pages/books/view.vue:5 m3/allow-rule", "src/pages/books/view.vue:6 ui/removed-prop"]);
  });
});

// The installed Vuetify, as its package lays out vuetify/components: an index of each component's own index.
const VUETIFY = {
  "node_modules/vuetify/package.json": {
    name: "vuetify",
    version: "4.3.2",
    type: "module",
    exports: { ".": "./lib/framework.js", "./components": { types: "./lib/components/index.d.ts", import: "./lib/components/index.js" } }
  },
  "node_modules/vuetify/lib/components/index.js": ["VBottomSheet", "VCard", "VDialog", "VMenu", "transitions"]
    .map((name) => `export * from "./${name}/index.js";`).join("\n"),
  "node_modules/vuetify/lib/components/VBottomSheet/index.js": "export { VBottomSheet } from \"./VBottomSheet.js\";\n",
  "node_modules/vuetify/lib/components/VCard/index.js": "export { VCard } from \"./VCard.js\";\nexport { VCardText, VCardTitle } from \"./VCardText.js\";\n",
  "node_modules/vuetify/lib/components/VDialog/index.js": "export { VDialog } from \"./VDialog.js\";\n",
  "node_modules/vuetify/lib/components/VMenu/index.js": "export { VMenu } from \"./VMenu.js\";\n",
  "node_modules/vuetify/lib/components/transitions/index.js": "export const VFadeTransition = createCssTransition(\"fade-transition\");\n"
};

test("a Vuetify component named for Vue to resolve at run time is a finding; one imported and passed is not", async () => {
  await withApp({
    "package.json": { name: "by-name", private: true },
    ...VUETIFY,
    "src/components/ConfirmHost.vue": component(
      [
        "import { h, resolveComponent, resolveDynamicComponent } from \"vue\";",
        "const dialog = resolveComponent(\"v-dialog\");",
        "const sheet = resolveDynamicComponent('VBottomSheet');",
        "const card = () => h(\"v-card\", {}, []);"
      ].join("\n"),
      "<component is=\"v-menu\" /><component :is=\"wide ? 'VDialog' : 'v-bottom-sheet'\" /><component :is=\"resolveComponent('v-card')\" />"
    ),
    "src/components/Imported.vue": component(
      [
        "import { h } from \"vue\";",
        "import { VCard, VDialog } from \"vuetify/components\";",
        "const card = () => h(VCard, {}, []);",
        "const label = \"v-dialog\";"
      ].join("\n"),
      "<component :is=\"VDialog\" /><component is=\"section\" /><v-dialog />"
    ),
    "src/lib/dialogs.js": "export const open = (h) => h(\"VDialog\");\n",
    // Names the installed Vuetify does not export are another library's to register.
    "src/components/Chart.vue": component(
      "import { h, resolveComponent } from \"vue\";\nconst chart = resolveComponent(\"v-chart\");\nconst tree = () => h(\"VTreeselect\");",
      "<component is=\"v-chart\" /><component :is=\"'VChart'\" /><component is=\"v-fade-transition\" />"
    )
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/components/Chart.vue:7 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:3 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:4 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:5 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:8 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:8 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:8 ui/vuetify-by-name",
      "src/components/ConfirmHost.vue:8 ui/vuetify-by-name",
      "src/lib/dialogs.js:1 ui/vuetify-by-name"
    ]);
    assert.equal(result.findings[1].message, "resolveComponent(\"v-dialog\") names Vuetify's VDialog for Vue to resolve at run time, " +
      "which finds nothing in a JSKIT app: Vuetify components are imported where a template writes their tag, never " +
      "registered by name, so Vue renders an unknown element. Import it, import { VDialog } from \"vuetify/components\", " +
      "and pass the component itself.");
    assert.deepEqual(result.findings.filter(({ line }) => line === 8).map(({ message }) => message.split(" names ")[0]), [
      "is=\"v-menu\"", ":is=\"'VDialog'\"", ":is=\"'v-bottom-sheet'\"", "resolveComponent(\"v-card\")"
    ]);
    assert.match(result.findings[0].message, /^is="v-fade-transition" names Vuetify's VFadeTransition /u);
  });
});

test("without Vuetify installed, no name is Vuetify's", async () => {
  await withApp({
    "package.json": { name: "no-vuetify", private: true },
    "src/lib/dialogs.js": "export const open = (h) => h(\"VDialog\");\n"
  }, async (root) => {
    assert.deepEqual(findingLines(await checkMaterial3({ projectRoot: root })), []);
  });
});
