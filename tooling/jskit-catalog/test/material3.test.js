import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkMaterial3, formatMaterial3Report, MATERIAL3_RULES } from "../scripts/material3.mjs";
import { parseArgs, usage } from "../scripts/jskit.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const SHELL_MANIFEST = { name: "m3-fixture", private: true, dependencies: { "@jskit-ai/shell-web": "0.2.8" } };

async function writeApp(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-m3-"));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`, "utf8");
  }
  return root;
}

async function withApp(files, run) {
  const root = await writeApp(files);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const findingLines = (result) => result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);

// The check with its navigation findings alone, for the tests of the nav/* rules.
async function checkNavigation(options) {
  const result = await checkMaterial3(options);
  return { ...result, findings: result.findings.filter(({ rule }) => rule.startsWith("nav/")) };
}

// Every rule fails at least once in this page; each line is numbered in the comment beside the expectation below.
const DRIFTING_PAGE = [
  "<script setup>", // 1
  "import { useRouter } from \"vue-router\";", // 2
  "import { mdiHome } from \"@mdi/js\";", // 3
  "const goBack = () => up();", // 4
  "const router = useRouter();", // 5
  "function leave() {", // 6
  "  window.location.href = \"/home\";", // 7
  "  router.push(\"/home/books\");", // 8
  "}", // 9
  "const accent = \"#ff8800\";", // 10
  "const icon = \"mdi-account\";", // 11
  "const links = [{ title: \"Shelves\", to: \"/home/shelves\" }];", // 12
  "</script>", // 13
  "", // 14
  "<template>", // 15
  "  <section>", // 16
  "    <h1>Books</h1>", // 17
  "    <v-btn to=\"/home/settings\">Settings</v-btn>", // 18
  "    <v-sheet border class=\"panel\">", // 19
  "      <v-card variant=\"outlined\" color=\"#123456\">", // 20
  "        <v-btn height=\"48\">Save</v-btn>", // 21
  "        <v-btn :to=\"listUrl\">Back to books</v-btn>", // 22
  "        <v-btn prepend-icon=\"$arrowBack\" @click=\"router.back()\"><v-icon>mdi-home</v-icon></v-btn>", // 23
  "        <v-btn icon=\"$chevronLeft\" :to=\"paths.page('/books')\" aria-label=\"Books\" />", // 24
  "        <v-btn icon=\"$prev\" @click=\"previousMonth\" aria-label=\"Previous month\" />", // 25
  "        <page-back-button @click=\"leave\" />", // 26
  "        <v-breadcrumbs :items=\"crumbs\" />", // 27
  "      </v-card>", // 28
  "    </v-sheet>", // 29
  "    <!-- m3-check: allow m3/raw-hex - the partner's logo colour is contractual -->", // 30
  "    <v-chip color=\"#0a7d3e\">Partner</v-chip>", // 31
  "    <!-- m3-check: allow m3/raw-hex -->", // 32
  "    <v-chip color=\"#0a7d3e\">Partner</v-chip>", // 33
  "    <!-- m3-check: allow nav/raw-link - the documentation is a static page -->", // 34
  "    <a href=\"/docs\">Docs</a>", // 35
  "    <a href=\"/exports/books.csv\">Export</a>", // 36
  "    <v-btn @click=\"goBack\">Done</v-btn>", // 37
  "  </section>", // 38
  "</template>", // 39
  "", // 40
  "<style scoped>", // 41
  ".panel :deep(.v-btn) {", // 42
  "  min-height: 48px;", // 43
  "  color: #fff;", // 44
  "}", // 45
  "</style>", // 46
  ""
].join("\n");

const DRIFTING_NAVIGATION = [
  "src/pages/home/books.vue:4 nav/back-control",
  "src/pages/home/books.vue:7 nav/window-location",
  "src/pages/home/books.vue:8 nav/raw-link",
  "src/pages/home/books.vue:12 nav/raw-link",
  "src/pages/home/books.vue:18 nav/raw-link",
  "src/pages/home/books.vue:22 nav/back-control",
  "src/pages/home/books.vue:23 nav/back-control",
  "src/pages/home/books.vue:23 nav/history",
  "src/pages/home/books.vue:24 nav/back-control",
  "src/pages/home/books.vue:26 nav/back-control",
  "src/pages/home/books.vue:27 nav/back-control",
  "src/pages/home/books.vue:34 nav/allow",
  "src/pages/home/books.vue:35 nav/raw-link",
  "src/pages/home/books.vue:37 nav/back-control"
];

const CONFORMING_PAGE = [
  "<script setup>",
  "import { usePaths } from \"@jskit-ai/shell-web/client/navigation/usePaths\";",
  "const paths = usePaths();",
  "const origin = window.location.origin;",
  "</script>",
  "",
  "<template>",
  "  <section class=\"d-flex flex-column ga-4\">",
  "    <Teleport to=\"#jskit-shell-page-actions\">",
  "      <v-btn color=\"primary\" prepend-icon=\"$add\" :to=\"paths.page('/books/new')\">New book</v-btn>",
  "    </Teleport>",
  "    <v-card color=\"surface-container-low\">",
  "      <h2 class=\"text-title-large\">Shelves</h2>",
  "      <a href=\"https://example.com/help\">Help</a>",
  "      <a href=\"#shelves\">Shelves</a>",
  "      <a href=\"/api/books.csv\" download>Export</a>",
  "      <v-btn variant=\"text\" @click=\"paths.page('/books')\">Feedback</v-btn>",
  "    </v-card>",
  "  </section>",
  "</template>",
  "",
  "<style scoped>",
  ".shelf { color: rgb(var(--v-theme-on-surface)); }",
  "</style>",
  ""
].join("\n");

// JSKIT's defaults generate the light and dark schemes from the seed at startup.
const CONFORMING_BOOTSTRAP = [
  "import { createVuetify } from \"vuetify\";",
  "import { createMaterialVuetifyOptions } from \"@jskit-ai/material-web/client\";",
  "import { theme } from \"./theme/index.js\";",
  "export const vuetify = createVuetify(createMaterialVuetifyOptions(theme));",
  ""
].join("\n");

const APP_THEME = "export const theme = { seed: \"#6750A4\", icons: {} };\n";

const DRIFTING_APP = {
  "package.json": SHELL_MANIFEST,
  "src/main.js": "import { createVuetify } from \"vuetify\";\nexport const vuetify = createVuetify({ theme: { defaultTheme: \"light\" } });\n",
  // A layout that shows the shell's page title (in a bar without Up), so the page's own h1 is a second one.
  "src/pages/home.vue": "<template>\n  <header><ShellPageTitle /></header>\n  <RouterView />\n</template>\n",
  "src/pages/home/books.vue": DRIFTING_PAGE,
  "src/theme/palette.js": "export const seed = \"#e0a526\";\n",
  "tests/e2e/books.spec.js": "await page.evaluate(() => history.back());\n",
  "server/email.js": "export const brand = \"#e0a526\";\n"
};

test("jskit check m3 reports each drifting pattern once, with its line and rule", async () => {
  await withApp(DRIFTING_APP, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.wholeApp, true);
    assert.deepEqual(result.files, ["src/main.js", "src/pages/home.vue", "src/pages/home/books.vue", "src/theme/palette.js"]);
    assert.deepEqual(findingLines(result), [
      "src/main.js:2 m3/dark-scheme",
      "src/main.js:2 m3/dark-scheme",
      "src/pages/home/books.vue:3 m3/mdi-icon",
      "src/pages/home/books.vue:4 nav/back-control",
      "src/pages/home/books.vue:7 nav/window-location",
      "src/pages/home/books.vue:8 nav/raw-link",
      "src/pages/home/books.vue:10 m3/raw-hex",
      "src/pages/home/books.vue:11 m3/mdi-icon",
      "src/pages/home/books.vue:12 nav/raw-link",
      "src/pages/home/books.vue:17 m3/duplicate-h1",
      "src/pages/home/books.vue:18 nav/raw-link",
      "src/pages/home/books.vue:19 m3/outlined-card",
      "src/pages/home/books.vue:20 m3/outlined-card",
      "src/pages/home/books.vue:20 m3/raw-hex",
      "src/pages/home/books.vue:21 m3/fixed-button-height",
      "src/pages/home/books.vue:22 nav/back-control",
      "src/pages/home/books.vue:23 nav/back-control",
      "src/pages/home/books.vue:23 nav/history",
      "src/pages/home/books.vue:23 m3/mdi-icon",
      "src/pages/home/books.vue:24 nav/back-control",
      "src/pages/home/books.vue:26 nav/back-control",
      "src/pages/home/books.vue:27 nav/back-control",
      "src/pages/home/books.vue:32 m3/allow-reason",
      "src/pages/home/books.vue:33 m3/raw-hex",
      "src/pages/home/books.vue:34 nav/allow",
      "src/pages/home/books.vue:35 nav/raw-link",
      "src/pages/home/books.vue:37 nav/back-control",
      "src/pages/home/books.vue:43 m3/fixed-button-height",
      "src/pages/home/books.vue:44 m3/raw-hex"
    ]);
    assert.match(formatMaterial3Report(result), /^Material 3 check: 29 finding\(s\) in 2 of 4 file\(s\) of the whole app\. Exceptions: 1\.$/mu);
    const darkScheme = result.findings.filter(({ rule }) => rule === "m3/dark-scheme").map(({ message }) => message);
    assert.match(darkScheme.join("\n"), /No dark colour scheme/u);
    assert.match(darkScheme.join("\n"), /pinned to light/u);
    for (const finding of result.findings) assert.ok(MATERIAL3_RULES[finding.rule], finding.rule);

    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), DRIFTING_NAVIGATION);
  });
});

// A colour written as channels is a raw colour too, as a hand-made shadow is; a theme role with an alpha is not.
const CHANNEL_COLOUR_PAGE = [
  "<script setup>", // 1
  "const lifted = \"0 4px 8px rgba(0,0,0,.3)\";", // 2
  "const themed = \"0 4px 8px rgba(var(--v-theme-shadow), 0.3)\";", // 3
  "</script>", // 4
  "", // 5
  "<template>", // 6
  "  <v-sheet style=\"box-shadow: 0 1px 2px rgb(0 0 0 / 20%)\">", // 7
  "    <v-chip color=\"rgba(0, 0, 0, 0.5)\">Muted</v-chip>", // 8
  "    <v-chip :style=\"{ boxShadow: `0 2px 4px hsla(0, 0%, 0%, 0.2)` }\">Bound</v-chip>", // 9
  "  </v-sheet>", // 10
  "</template>", // 11
  "", // 12
  "<style scoped>", // 13
  ".card {", // 14
  "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(var(--v-theme-shadow), 0.3);", // 15
  "  color: rgb(var(--v-theme-on-surface));", // 16
  "}", // 17
  "</style>", // 18
  ""
].join("\n");

test("m3/raw-hex finds colours written as channels, as in hand-made shadows, and leaves theme roles alone", async () => {
  await withApp({
    "package.json": SHELL_MANIFEST,
    "src/pages/home/cards.vue": CHANNEL_COLOUR_PAGE,
    "src/theme/index.js": "export const shadow = \"rgba(0, 0, 0, 0.2)\";\n"
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result).filter((line) => line.endsWith("m3/raw-hex")), [
      "src/pages/home/cards.vue:2 m3/raw-hex",
      "src/pages/home/cards.vue:7 m3/raw-hex",
      "src/pages/home/cards.vue:8 m3/raw-hex",
      "src/pages/home/cards.vue:9 m3/raw-hex",
      "src/pages/home/cards.vue:15 m3/raw-hex"
    ]);
    assert.match(result.findings.find(({ line }) => line === 15).message, /^Raw colour rgba\(0, 0, 0, 0\.15\)\. Use rgb\(var\(--v-theme-<role>\)\), with an alpha for a shadow or scrim/u);
  });
});

// #241: one line's `m3-check: allow <m3 rule> - <reason>` is the only exception. Nothing excuses a navigation rule,
// and an exception without a reason or naming an unknown rule excuses nothing and is itself a finding.
const EXCEPTION_PAGE = [
  "<template>", // 1
  "  <!-- m3-check: allow m3/raw-hex - the partner's logo colour is contractual -->", // 2
  "  <v-chip color=\"#0a7d3e\">Partner</v-chip>", // 3
  "  <v-chip color=\"#0a7d3e\">Unexcused</v-chip>", // 4
  "  <v-chip color=\"#0a7d3e\">Same line</v-chip> <!-- m3-check: allow m3/raw-hex - the partner's mark -->", // 5
  "  <!-- m3-check: allow m3/raw-hex -->", // 6
  "  <v-chip color=\"#0a7d3e\">No reason</v-chip>", // 7
  "  <!-- m3-check: allow m3/raw-colour - a misspelt rule -->", // 8
  "  <v-chip color=\"#0a7d3e\">Unknown rule</v-chip>", // 9
  "  <!-- m3-check: allow nav/raw-link - the documentation is a static page -->", // 10
  "  <a href=\"/docs\">Docs</a>", // 11
  "  <!-- m3-check: allow nav/* - legacy screens -->", // 12
  "  <!-- m3-check: allow m3/allow-reason - silence the reasonless one -->", // 13
  "</template>", // 14
  ""
].join("\n");

test("an exception excuses one m3/* rule on its line or the next, with a reason, and is listed", async () => {
  await withApp({ "package.json": SHELL_MANIFEST, "src/pages/home/partners.vue": EXCEPTION_PAGE }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/pages/home/partners.vue:4 m3/raw-hex",
      "src/pages/home/partners.vue:6 m3/allow-reason",
      "src/pages/home/partners.vue:7 m3/raw-hex",
      "src/pages/home/partners.vue:8 m3/allow-rule",
      "src/pages/home/partners.vue:9 m3/raw-hex",
      "src/pages/home/partners.vue:10 nav/allow",
      "src/pages/home/partners.vue:11 nav/raw-link",
      "src/pages/home/partners.vue:12 nav/allow",
      "src/pages/home/partners.vue:13 m3/allow-rule"
    ]);
    assert.deepEqual(result.exceptions, [
      { file: "src/pages/home/partners.vue", line: 2, rule: "m3/raw-hex", reason: "the partner's logo colour is contractual" },
      { file: "src/pages/home/partners.vue", line: 5, rule: "m3/raw-hex", reason: "the partner's mark" }
    ]);
    const report = formatMaterial3Report(result);
    assert.match(report, /^Exceptions \(2\):\nsrc\/pages\/home\/partners\.vue:2 {2}m3\/raw-hex {2}the partner's logo colour is contractual\nsrc\/pages\/home\/partners\.vue:5 {2}m3\/raw-hex {2}the partner's mark$/mu);
    assert.match(report, / Exceptions: 2\.$/u);
    assert.match(result.findings.find(({ line }) => line === 10).message, /Nothing excuses a navigation rule \(nav\/raw-link\)/u);
    assert.match(result.findings.find(({ line }) => line === 8).message, /m3\/raw-colour is not a Material 3 rule/u);

    // An exception naming a navigation rule is a finding, and the line it meant to excuse stays one.
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), [
      "src/pages/home/partners.vue:10 nav/allow",
      "src/pages/home/partners.vue:11 nav/raw-link",
      "src/pages/home/partners.vue:12 nav/allow"
    ]);
  });
});

test("nothing turns the check off for an app, a folder or a file", async () => {
  const page = "<template>\n  <v-card variant=\"outlined\" color=\"#123456\" />\n  <a href=\"/home/books\">Books</a>\n</template>\n";
  await withApp({
    "package.json": { ...SHELL_MANIFEST, jskit: { check: false, m3: { enabled: false, allow: ["m3/*", "nav/*"] } }, "m3-check": "off" },
    ".m3-check.json": { disabled: true, allow: ["m3/raw-hex", "nav/raw-link"] },
    "src/pages/home/.m3-check": "allow m3/raw-hex - the whole folder\n",
    "src/pages/home/m3-check.config.js": "export default { disabled: true };\n",
    "src/pages/home/off.vue": `<!-- m3-check: off -->\n${page}`,
    "src/pages/home/disabled.vue": `<!-- m3-check: disable-file - legacy -->\n${page}`,
    "src/pages/home/wildcard.vue": `<!-- m3-check: allow m3/* - legacy screens -->\n${page}`,
    "src/pages/home/far.vue": `<!-- m3-check: allow m3/raw-hex - only reaches the next line -->\n\n${page}`
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/pages/home/disabled.vue:1 m3/allow-rule",
      "src/pages/home/disabled.vue:3 m3/outlined-card",
      "src/pages/home/disabled.vue:3 m3/raw-hex",
      "src/pages/home/disabled.vue:4 nav/raw-link",
      "src/pages/home/far.vue:4 m3/outlined-card",
      "src/pages/home/far.vue:4 m3/raw-hex",
      "src/pages/home/far.vue:5 nav/raw-link",
      "src/pages/home/off.vue:1 m3/allow-rule",
      "src/pages/home/off.vue:3 m3/outlined-card",
      "src/pages/home/off.vue:3 m3/raw-hex",
      "src/pages/home/off.vue:4 nav/raw-link",
      "src/pages/home/wildcard.vue:1 m3/allow-rule",
      "src/pages/home/wildcard.vue:3 m3/outlined-card",
      "src/pages/home/wildcard.vue:3 m3/raw-hex",
      "src/pages/home/wildcard.vue:4 nav/raw-link"
    ]);
    assert.deepEqual(result.exceptions, [
      { file: "src/pages/home/far.vue", line: 1, rule: "m3/raw-hex", reason: "only reaches the next line" }
    ]);
    const navigation = await checkNavigation({ projectRoot: root });
    assert.equal(navigation.findings.length, 4);
  });
});

test("jskit check m3 passes conforming source, the generated scheme and non-UI code", async () => {
  await withApp({
    "package.json": SHELL_MANIFEST,
    "src/main.js": CONFORMING_BOOTSTRAP,
    "src/theme/index.js": APP_THEME,
    "src/pages/home/books.vue": CONFORMING_PAGE,
    "packages/shelves/src/server/report.js": "export const accent = \"#e0a526\";\n"
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), []);
    assert.equal(result.ok, true);
    assert.match(formatMaterial3Report(result), /^Material 3 check: no findings in 3 file\(s\) of the whole app\. Exceptions: 0\.$/u);
  });
});

// JSKIT's own repository: the framework's packages implement the navigation the rules send apps to, so a whole-app run
// reads only their patterns and templates; a path given to jskit check m3 is read as asked, and an app's own package
// keeps every rule.
test("a whole-app check reads a JSKIT package's patterns and templates, not its implementation", async () => {
  const leaving = "export function leave(url) {\n  window.location.assign(url);\n}\n";
  await withApp({
    "package.json": SHELL_MANIFEST,
    "packages/shell-web/package.json": JSON.stringify({ name: "@jskit-ai/shell-web" }),
    "packages/shell-web/src/client/leave.js": leaving,
    "packages/shell-web/templates/src/leave.js": leaving,
    "packages/shelves/package.json": JSON.stringify({ name: "@local/shelves" }),
    "packages/shelves/src/client/leave.js": leaving
  }, async (root) => {
    const whole = await checkNavigation({ projectRoot: root });
    assert.deepEqual(whole.files, ["packages/shell-web/templates/src/leave.js", "packages/shelves/src/client/leave.js"]);
    assert.deepEqual(whole.findings.map(({ file, rule }) => `${file} ${rule}`), [
      "packages/shell-web/templates/src/leave.js nav/window-location",
      "packages/shelves/src/client/leave.js nav/window-location"
    ]);
    const asked = await checkNavigation({ projectRoot: root, paths: ["packages/shell-web"] });
    assert.ok(asked.files.includes("packages/shell-web/src/client/leave.js"));
  });
});

test("jskit check m3 narrows to given paths and checks the scheme only with the bootstrap or theme", async () => {
  await withApp(DRIFTING_APP, async (root) => {
    const section = await checkMaterial3({ projectRoot: root, paths: ["src/pages", "src/pages/home/gone.vue"] });
    assert.equal(section.wholeApp, false);
    assert.deepEqual(section.files, ["src/pages/home.vue", "src/pages/home/books.vue"]);
    assert.deepEqual(section.missing, ["src/pages/home/gone.vue"]);
    assert.equal(section.findings.some(({ rule }) => rule === "m3/dark-scheme"), false);
    assert.match(formatMaterial3Report(section), /Skipped src\/pages\/home\/gone\.vue: not found\./u);

    const theme = await checkMaterial3({ projectRoot: root, paths: ["src/theme/palette.js", "tests/e2e/books.spec.js"] });
    assert.deepEqual(theme.files, ["src/theme/palette.js"]);
    assert.deepEqual(findingLines(theme), ["src/main.js:2 m3/dark-scheme", "src/main.js:2 m3/dark-scheme"]);

    await assert.rejects(checkMaterial3({ projectRoot: root, paths: ["../elsewhere"] }), /inside the application only/u);
  });
});

test("an in-page h1 is a finding only in an app that uses the JSKIT shell", async () => {
  await withApp({
    "package.json": { name: "landing", private: true },
    "src/pages/index.vue": "<template>\n  <h1>Welcome</h1>\n  <h1>Again</h1>\n</template>\n"
  }, async (root) => {
    assert.deepEqual(findingLines(await checkMaterial3({ projectRoot: root })), ["src/pages/index.vue:3 m3/duplicate-h1"]);
  });
});

// Only a page under the shell's page title has its title there: a hero front page, an invite page and the components
// only they render own their h1; a page a shell layout renders, a layout's own bar and the components they render
// do not, and nor does a component whose page can't be read (one routed from JavaScript). The not-found component
// main.js hands the shell renders outside every layout, like App.vue.
test("an in-page h1 is a finding only under the shell's page title", async () => {
  const h1 = (title) => `<template>\n  <h1>${title}</h1>\n</template>\n`;
  const app = {
    "package.json": SHELL_MANIFEST,
    "src/main.js": [
      "import { createShellRouter } from \"@jskit-ai/kernel/client\";",
      "import NotFound from \"./views/NotFound.vue\";",
      "import RoutedFromJs from \"./views/RoutedFromJs.vue\";",
      "const extra = [{ path: \"/extra\", component: RoutedFromJs }];",
      "createShellRouter({ routes: extra, notFoundComponent: NotFound });",
      ""
    ].join("\n"),
    "src/views/NotFound.vue": h1("Page not found"),
    "src/App.vue": "<template>\n  <RouterView />\n</template>\n",
    "src/pages/index.vue": h1("Welcome"),
    "src/pages/invite/[token].vue": "<script setup>\nimport InviteHero from \"@/components/InviteHero.vue\";\n</script>\n<template>\n  <InviteHero />\n</template>\n",
    "src/components/InviteHero.vue": h1("You're invited"),
    "src/pages/home.vue": "<script setup>\nimport ShellLayout from \"@/components/ShellLayout.vue\";\n</script>\n<template>\n  <ShellLayout>\n    <RouterView />\n  </ShellLayout>\n</template>\n",
    "src/pages/home/books.vue": "<script setup>\nimport BookHeader from \"./_components/BookHeader.vue\";\n</script>\n<template>\n  <BookHeader />\n  <h1>Books</h1>\n</template>\n",
    "src/pages/home/_components/BookHeader.vue": h1("Books"),
    "src/pages/studio.vue": "<template>\n  <v-app-bar><ShellPageTitle /></v-app-bar>\n  <RouterView />\n</template>\n",
    "src/pages/studio/index.vue": h1("Studio"),
    "src/views/RoutedFromJs.vue": h1("Routed")
  };
  const h1Findings = async (root) => findingLines(await checkMaterial3({ projectRoot: root })).filter((line) => line.endsWith("m3/duplicate-h1"));
  await withApp(app, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result).filter((line) => line.endsWith("m3/duplicate-h1")), [
      "src/pages/home/_components/BookHeader.vue:2 m3/duplicate-h1",
      "src/pages/home/books.vue:6 m3/duplicate-h1",
      "src/pages/studio/index.vue:2 m3/duplicate-h1",
      "src/views/RoutedFromJs.vue:2 m3/duplicate-h1"
    ]);
    assert.match(result.findings.find(({ rule }) => rule === "m3/duplicate-h1").message, /under the top app bar/u);
  });
  // Under an App.vue that shows the title, the not-found component is under it too.
  const appShell = "<script setup>\nimport ShellLayout from \"@/components/ShellLayout.vue\";\n</script>\n<template>\n  <ShellLayout><RouterView /></ShellLayout>\n</template>\n";
  await withApp({ ...app, "src/App.vue": appShell }, async (root) => {
    assert.ok((await h1Findings(root)).includes("src/views/NotFound.vue:2 m3/duplicate-h1"));
  });
});

// Only one branch of a v-if chain renders, so h1s on different branches are one title at a time: a sign-in view
// with an h1 per step, or a page whose states each carry their own. Two h1s that can show together still are two.
test("h1s on different branches of a v-if chain count as one title", async () => {
  const steps = [
    "<template>",
    "  <DefaultLoginView v-if=\"passwordFlow\" />",
    "  <div v-else class=\"screen\">",
    "    <template v-if=\"handlingCallback\">",
    "      <v-progress-circular indeterminate />",
    "    </template>",
    "    <template v-else-if=\"callbackError\">",
    "      <div><h1>This link did not work</h1></div>",
    "    </template>",
    "    <template v-else-if=\"sent\">",
    "      <div><h1>Check your email</h1></div>",
    "    </template>",
    "    <template v-else>",
    "      <div><h1>Sign in</h1><br><img src=\"/logo.svg\" alt=\"\"></div>",
    "    </template>",
    "  </div>",
    "</template>",
    ""
  ].join("\n");
  const states = [
    "<template>",
    "  <section v-if=\"done\"><h1 v-if=\"pending\">We have your request</h1><h1 v-else>Booked</h1></section>",
    "  <section v-else-if=\"!hasPets\"><h1>Add your dog</h1></section>",
    "  <div v-else>",
    "    <h1>What would you like to book?</h1>",
    "    <h1 v-if=\"grouped\">Book for several dogs</h1>",
    "  </div>",
    "  <h1 v-if=\"promo\">Spring offer</h1>",
    "</template>",
    ""
  ].join("\n");
  await withApp({
    "package.json": SHELL_MANIFEST,
    "src/App.vue": "<template>\n  <RouterView />\n</template>\n",
    "src/pages/sign-in.vue": steps,
    "src/pages/book.vue": states
  }, async (root) => {
    // The grouped heading shows beside the booking one, and the promotion's beside any state's.
    assert.deepEqual(findingLines(await checkMaterial3({ projectRoot: root })).filter((line) => line.endsWith("m3/duplicate-h1")), [
      "src/pages/book.vue:6 m3/duplicate-h1",
      "src/pages/book.vue:8 m3/duplicate-h1"
    ]);
  });
});

// Which branch of a layout renders a page is decided at runtime, so a layout that renders its pages outside the
// ShellLayout on one branch (a shop device's staff sign-in in a bare v-main) leaves their h1s unjudged; one that
// always renders them under the title does not.
test("an h1 is judged only under a layout that always renders its pages under the page title", async () => {
  const signIn = "<template>\n  <h1>Who's working?</h1>\n</template>\n";
  const shared = [
    "<script setup>",
    "import ShellLayout from \"@/components/ShellLayout.vue\";",
    "</script>",
    "<template>",
    "  <v-main v-if=\"sharedDevice\"><RouterView /></v-main>",
    "  <ShellLayout v-else><RouterView /></ShellLayout>",
    "</template>",
    ""
  ].join("\n");
  const app = {
    "package.json": SHELL_MANIFEST,
    "src/App.vue": "<template>\n  <RouterView />\n</template>\n",
    "src/pages/admin.vue": shared,
    "src/pages/admin/staff-sign-in.vue": signIn
  };
  await withApp(app, async (root) => {
    assert.deepEqual(findingLines(await checkMaterial3({ projectRoot: root })).filter((line) => line.endsWith("m3/duplicate-h1")), []);
  });
  const always = "<script setup>\nimport ShellLayout from \"@/components/ShellLayout.vue\";\n</script>\n<template>\n  <ShellLayout><RouterView /></ShellLayout>\n</template>\n";
  await withApp({ ...app, "src/pages/admin.vue": always }, async (root) => {
    assert.deepEqual(findingLines(await checkMaterial3({ projectRoot: root })).filter((line) => line.endsWith("m3/duplicate-h1")), [
      "src/pages/admin/staff-sign-in.vue:2 m3/duplicate-h1"
    ]);
  });
});

// Content colours (an identity palette, artwork, a brand mark) are named hex exports of src/theme/palettes.js, read
// by bindings and used as they are in both schemes; a hex written in a component is still a finding that names them.
test("content colours live in src/theme/palettes.js and components read them through bindings", async () => {
  await withApp({
    "package.json": SHELL_MANIFEST,
    "src/main.js": CONFORMING_BOOTSTRAP,
    "src/theme/index.js": APP_THEME,
    "src/theme/palettes.js": "export const botColours = [\"#6750A4\", \"#B3261E\", \"#386A20\"];\nexport const fileTypeTints = { js: \"#F7DF1E\", py: \"#3776AB\" };\n",
    "src/components/BotBadge.vue": [
      "<script setup>",
      "import { botColours, fileTypeTints } from \"../theme/palettes.js\";",
      "const props = defineProps({ bot: { type: Object, required: true } });",
      "const ring = botColours[props.bot.colour];",
      "</script>",
      "<template>",
      "  <v-avatar :style=\"{ backgroundColor: botColours[bot.colour] }\">",
      "    <svg viewBox=\"0 0 24 24\"><path :fill=\"fileTypeTints[bot.language]\" d=\"M0 0h24v24H0z\" /></svg>",
      "    <svg viewBox=\"0 0 24 24\"><path fill=\"#F7DF1E\" d=\"M0 0h24v24H0z\" /></svg>",
      "  </v-avatar>",
      "</template>",
      "<style scoped>",
      ".v-avatar { outline: 2px solid v-bind(ring); }",
      "</style>",
      ""
    ].join("\n")
  }, async (root) => {
    const result = await checkMaterial3({ projectRoot: root });
    assert.deepEqual(findingLines(result), ["src/components/BotBadge.vue:9 m3/raw-hex"]);
    assert.match(result.findings[0].message, /named export of src\/theme\/palettes\.js/u);
  });
});

const SHELL_LAYOUT = [
  "<route lang=\"json\">",
  "{ \"meta\": { \"jskit\": { \"surface\": \"home\" } } }",
  "</route>",
  "<script setup>",
  "import ShellLayout from \"@/components/ShellLayout.vue\";",
  "</script>",
  "<template>",
  "  <ShellLayout>",
  "    <RouterView />",
  "  </ShellLayout>",
  "</template>",
  ""
].join("\n");
const pageWith = (declaration) => `<script setup>\n${declaration}\n</script>\n<template>\n  <section />\n</template>\n`;

// Two shell surfaces (home, and admin under a workspace), a surface without the shell (auth), main navigation in both
// placement styles, and pages that declare their parent in definePage() or a route block.
const PARENT_APP = {
  "package.json": { name: "nav-fixture", private: true },
  "package-lock.json": { name: "nav-fixture", lockfileVersion: 3, packages: { "": { name: "nav-fixture" } } },
  "config/public.js": [
    "const config = {};",
    "config.surfaceDefinitions = {};",
    "config.surfaceDefinitions.home = { id: \"home\", pagesRoot: \"home\" };",
    "config.surfaceDefinitions.auth = { id: \"auth\", pagesRoot: \"auth\" };",
    "config.surfaceDefinitions.admin = { id: \"admin\", pagesRoot: \"w/[workspaceSlug]/admin\" };",
    "export { config };",
    ""
  ].join("\n"),
  "src/placement.js": [
    "addPlacement({",
    "  id: \"app.suppliers\",",
    "  target: \"shell.primary-nav\",",
    "  kind: \"link\",",
    "  surfaces: [\"home\"],",
    "  props: { label: \"Suppliers\", surface: \"home\", scopedSuffix: \"/suppliers\", unscopedSuffix: \"/suppliers\" }",
    "});",
    "addPlacement({ id: \"app.jobs\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"admin\"], props: { scopedSuffix: \"/jobs\" } });",
    "addPlacement({ id: \"app.reports\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"home\"], props: { scopedSuffix: \"/reports\" } });",
    "// A placement's link props are JSKIT navigation input, so a global route such as sign-in may be named by path.",
    "addPlacement({ id: \"auth.sign-in\", target: \"auth.profile-menu\", kind: \"link\", surfaces: [\"*\"], props: { label: \"Sign in\", to: \"/auth/login\" } });",
    ""
  ].join("\n"),
  "src/placements/menu.js": [
    "export const MENU = Object.freeze([",
    "  {",
    "    id: \"app.contacts\",",
    "    target: \"shell.primary-nav\",",
    "    kind: \"link\",",
    "    surfaces: [\"home\"],",
    "    props: { label: \"Contacts\", surface: \"home\", scopedSuffix: \"/contacts?view=all\", unscopedSuffix: \"/contacts\" }",
    "  },",
    "  { id: \"app.orders\", target: \"shell.secondary-nav\", kind: \"link\", surfaces: [\"home\"], props: { scopedSuffix: \"/orders\" } }",
    "]);",
    ""
  ].join("\n"),
  "src/pages/home.vue": SHELL_LAYOUT,
  "src/pages/home/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/suppliers/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/suppliers/[supplierId]/index.vue": pageWith("definePage({ meta: { jskit: { parent: \"/suppliers\" } } });"),
  "src/pages/home/suppliers/[supplierId]/edit.vue": pageWith("definePage({ meta: { jskit: { guard: { policy: \"authenticated\" } } } });"),
  "src/pages/home/contacts/index.vue": pageWith("definePage({ meta: { jskit: { parent: \"/\" } } });"),
  "src/pages/home/contacts/[contactId].vue": "<route lang=\"json\">\n{ \"meta\": { \"jskit\": { \"parent\": \"/contacts\" } } }\n</route>\n<template>\n  <section />\n</template>\n",
  "src/pages/home/settings.vue": "<template>\n  <section>\n    <RouterView />\n  </section>\n</template>\n",
  "src/pages/home/settings/index.vue": pageWith("definePage({ redirect: redirectToChild(\"general\") });"),
  "src/pages/home/settings/general/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/auth/login.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/w/[workspaceSlug]/admin.vue": SHELL_LAYOUT,
  "src/pages/w/[workspaceSlug]/admin/jobs/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/w/[workspaceSlug]/admin/jobs/[jobId]/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/contacts/_components/ContactForm.vue": "<template>\n  <v-form />\n</template>\n",
  "src/pages/home/orders/index/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/orders/index/[orderId]/index.vue": pageWith("definePage({ meta: { jskit: { parent: \"/orders\" } } });"),
  "src/pages/home/reports.vue": "<template>\n  <section>\n    <RouterView />\n  </section>\n</template>\n",
  "src/pages/home/reports/overview.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/w/[workspaceSlug]/admin/workspace/settings.vue": pageWith("definePage({ meta: { jskit: { parent: \"/\" } } });").replace("<section />", "<RouterView />"),
  "src/pages/w/[workspaceSlug]/admin/workspace/settings/members.vue": "<template>\n  <section />\n</template>\n"
};

test("every inner shell page declares a parent and no main-navigation page declares one", async () => {
  await withApp(PARENT_APP, async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/pages/home/contacts/index.vue:2 nav/top-level-parent",
      "src/pages/home/settings/general/index.vue:1 nav/missing-parent",
      "src/pages/home/suppliers/[supplierId]/edit.vue:2 nav/missing-parent",
      "src/pages/w/[workspaceSlug]/admin/jobs/[jobId]/index.vue:1 nav/missing-parent"
    ]);
    assert.deepEqual(result.pages.map(({ route, surface, topLevel, parent }) => [surface, route, topLevel ? "top" : "", parent || ""].join(" ").trim()), [
      "home /contacts/:contactId  own",
      "home /contacts top own",
      "home / top",
      "home /orders/:orderId  own",
      "home /orders top",
      "home /reports/overview top",
      "home /settings/general",
      "home /suppliers/:supplierId/edit",
      "home /suppliers/:supplierId  own",
      "home /suppliers top",
      "admin /jobs/:jobId",
      "admin /jobs top",
      "admin /workspace/settings/members  inherited"
    ]);
    assert.match(result.findings[3].message, /Inner page \/jobs\/:jobId of admin has no parent/u);

    const section = await checkMaterial3({ projectRoot: root, paths: ["src/pages/home/suppliers"] });
    assert.deepEqual(findingLines(section), ["src/pages/home/suppliers/[supplierId]/edit.vue:2 nav/missing-parent"]);
  });
});

// A Home link shown on the account surface too: it names its surface, so it leads to home's "/" from both.
const accountApp = (homeLinkProps) => ({
  "package.json": SHELL_MANIFEST,
  "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.home = { id: \"home\", pagesRoot: \"home\" };\nconfig.surfaceDefinitions.account = { id: \"account\", pagesRoot: \"account\" };\nexport { config };\n",
  "src/placement.js": `addPlacement({ id: "app.home", target: "shell.primary-nav", kind: "link", surfaces: ["home", "account"], props: ${homeLinkProps} });\n`,
  "src/pages/home.vue": SHELL_LAYOUT,
  "src/pages/home/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/account.vue": SHELL_LAYOUT.replace("\"surface\": \"home\"", "\"surface\": \"account\""),
  "src/pages/account/index.vue": pageWith("definePage({ meta: { jskit: { parent: { surface: \"home\", path: \"/\" } } } });")
});

test("a main-navigation link that names its surface is a destination of that surface only", async () => {
  await withApp(accountApp("{ label: \"Home\", surface: \"home\", scopedSuffix: \"/\" }"), async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
  // A link that names no surface leads to "/" on each surface it shows on, so account's "/" is a destination.
  await withApp(accountApp("{ label: \"Start\", scopedSuffix: \"/\" }"), async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), [
      "src/pages/account/index.vue:2 nav/top-level-parent"
    ]);
  });
});

test("a page that declares a parent under no shell layout is a finding: its title, Up and actions never show", async () => {
  const app = accountApp("{ label: \"Home\", surface: \"home\", scopedSuffix: \"/\" }");
  delete app["src/pages/account.vue"];
  await withApp(app, async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), ["src/pages/account/index.vue:2 nav/missing-shell-layout"]);
    assert.match(result.findings[0].message, /Give the surface its layout, src\/pages\/account\.vue: ShellLayout around <RouterView \/>, with meta\.jskit\.surface "account"/u);
  });
  // An App.vue that draws the bar around every page leaves none outside it.
  await withApp({ ...app, "src/App.vue": "<script setup>\nimport ShellLayout from \"@/components/ShellLayout.vue\";\n</script>\n<template>\n  <ShellLayout><RouterView /></ShellLayout>\n</template>\n" }, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
});

// A package's pages (package.json jskit.metadata.ui.routes, with its client entry's routeComponents) are shell pages
// too: the kernel adds each at the top level, so it shows the shell's bar only when its component draws it, and its Up
// is the parent its package.json declares. Findings point at the route's entry in package.json.
const PACKAGE_ROUTES = [
  { id: "manage", path: "/home/manage", scope: "surface", surface: "home", componentKey: "shell" },
  { id: "manage.view", path: "/home/manage/:view", scope: "surface", surface: "home", componentKey: "shell" },
  { id: "manage.audit", path: "/home/manage/audit", scope: "surface", surface: "home", componentKey: "shell", meta: { jskit: { parent: "/manage" } } },
  { id: "manage.rooted", path: "/home/manage/rooted", scope: "surface", surface: "home", componentKey: "shell", meta: { jskit: { surface: "home", parent: "/manage" } } },
  { id: "manage.bare", path: "/home/manage/bare", scope: "surface", surface: "home", componentKey: "bare", meta: { jskit: { parent: "/manage" } } },
  { id: "manage.hidden", path: "/home/manage/hidden", scope: "surface", surface: "home", componentKey: "shell", autoRegister: false },
  { id: "account", path: "/account", scope: "global", componentKey: "account", meta: { jskit: { parent: { surface: "home", path: "/" } } } },
  { id: "help", path: "/help", scope: "global", componentKey: "shell", meta: { jskit: { parent: "/" } } },
  { id: "jobs.job", path: "/w/:workspaceSlug/admin/jobs/:jobId", scope: "surface", surface: "admin", componentKey: "shell" }
];
const PACKAGE_MANIFEST = { name: "@local/manage", version: "0.1.0", exports: { "./client": "./src/client/index.js" }, jskit: { metadata: { ui: { routes: PACKAGE_ROUTES } } } };
const packageRouteApp = (extra = {}) => ({
  "package.json": SHELL_MANIFEST,
  "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.home = { id: \"home\", pagesRoot: \"home\" };\nconfig.surfaceDefinitions.admin = { id: \"admin\", pagesRoot: \"w/[workspaceSlug]/admin\" };\nexport { config };\n",
  "src/placement.js": [
    "addPlacement({ id: \"app.manage\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"home\"], props: { surface: \"home\", scopedSuffix: \"/manage\", unscopedSuffix: \"/manage\" } });",
    "addPlacement({ id: \"app.help\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"*\"], props: { label: \"Help\", to: \"/help\" } });",
    ""
  ].join("\n"),
  "src/pages/home.vue": SHELL_LAYOUT,
  "src/pages/home/index.vue": "<template>\n  <section />\n</template>\n",
  "packages/manage/package.json": PACKAGE_MANIFEST,
  "packages/manage/src/client/index.js": [
    "import AccountPage from \"./AccountPage.vue\";",
    "",
    "// The pages this package's package.json routes name.",
    "const routeComponents = Object.freeze({",
    "  shell: () => import(\"./ManagePage.vue\"),",
    "  \"bare\": () => import(\"./BarePage.vue\"),",
    "  account: AccountPage",
    "});",
    "",
    "export { routeComponents };",
    ""
  ].join("\n"),
  "packages/manage/src/client/ManagePage.vue": "<script setup>\nimport ShellLayout from \"@jskit-ai/shell-web/client/components/ShellLayout\";\n</script>\n<template>\n  <ShellLayout><section /></ShellLayout>\n</template>\n",
  "packages/manage/src/client/AccountPage.vue": "<script setup>\nimport ShellLayout from \"@jskit-ai/shell-web/client/components/ShellLayout\";\n</script>\n<template>\n  <ShellLayout>\n    <h1>Account</h1>\n  </ShellLayout>\n</template>\n",
  "packages/manage/src/client/BarePage.vue": "<template>\n  <main>\n    <h1>Bare</h1>\n  </main>\n</template>\n",
  ...extra
});
const manifestLine = (pattern) => JSON.stringify(PACKAGE_MANIFEST, null, 2).split("\n").findIndex((line) => pattern.test(line)) + 1;
const routeLine = (id) => manifestLine(new RegExp(`"id": "${id.replace(".", "\\.")}"`, "u"));
// The "parent" key that follows the route's "id".
const parentLine = (id) => {
  const lines = JSON.stringify(PACKAGE_MANIFEST, null, 2).split("\n");
  const start = routeLine(id) - 1;
  return start + lines.slice(start).findIndex((line) => line.includes("\"parent\"")) + 1;
};

test("a package's routes are shell pages: inner ones declare a parent in package.json, top-level ones none", async () => {
  await withApp(packageRouteApp(), async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    const manifest = "packages/manage/package.json";
    assert.deepEqual(findingLines(result), [
      `${manifest}:${routeLine("manage.view")} nav/missing-parent`,
      `${manifest}:${parentLine("manage.rooted")} nav/surface-parent`,
      `${manifest}:${parentLine("manage.bare")} nav/missing-shell-layout`,
      `${manifest}:${parentLine("help")} nav/top-level-parent`,
      `${manifest}:${routeLine("jobs.job")} nav/missing-parent`
    ].sort((left, right) => Number(left.split(":")[1].split(" ")[0]) - Number(right.split(":")[1].split(" ")[0])));
    const message = (rule) => result.findings.find((finding) => finding.rule === rule).message;
    assert.match(message("nav/missing-parent"), /Inner page \/home\/manage\/:view \(route "manage\.view" of packages\/manage\/package\.json\) of home has no parent\. Declare it in the route's meta/u);
    assert.match(message("nav/missing-shell-layout"), /its component, packages\/manage\/src\/client\/BarePage\.vue, doesn't draw the shell's top app bar/u);
    assert.match(message("nav/surface-parent"), /Remove meta\.jskit\.surface; the route's own "surface" chooses where it is served/u);
    assert.deepEqual(result.pages.filter(({ file }) => file.startsWith("packages/")).map(({ route, surface, topLevel, parent }) => [surface, route, topLevel ? "top" : "", parent || ""].join(" ").trim()), [
      "home /manage top",
      "home /manage/:view",
      "home /manage/audit  own",
      "home /manage/rooted  own",
      "global /account  own",
      "global /help top own",
      "admin /jobs/:jobId"
    ]);

    // A run over the package's files judges its routes too.
    const section = await checkNavigation({ projectRoot: root, paths: ["packages/manage"] });
    assert.equal(section.findings.filter(({ rule }) => rule.startsWith("nav/")).length, 5);
  });
  // An App.vue that draws the bar around every page puts the bare page under it too.
  const appShell = { "src/App.vue": "<script setup>\nimport ShellLayout from \"@/components/ShellLayout.vue\";\n</script>\n<template>\n  <ShellLayout><RouterView /></ShellLayout>\n</template>\n" };
  await withApp(packageRouteApp(appShell), async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.equal(result.findings.some(({ rule }) => rule === "nav/missing-shell-layout"), false);
  });
});

test("a package route's page has the bar's title only when it draws the bar, as the kernel adds it at the top level", async () => {
  await withApp(packageRouteApp(), async (root) => {
    const result = await checkMaterial3({ projectRoot: root, paths: ["packages/manage/src"] });
    assert.deepEqual(result.findings.filter(({ rule }) => rule === "m3/duplicate-h1").map(({ file }) => file), ["packages/manage/src/client/AccountPage.vue"]);
  });
});

// Main navigation is literal data: a placement whose destination is computed can't be read, so it is a finding, and
// no page is judged for a missing parent while one is unreadable.
const placementApp = (placement) => ({
  "package.json": SHELL_MANIFEST,
  "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.home = { id: \"home\", pagesRoot: \"home\" };\nexport { config };\n",
  "src/placement.js": placement,
  "src/pages/home.vue": SHELL_LAYOUT,
  "src/pages/home/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/books/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/home/shelves/index.vue": "<template>\n  <section />\n</template>\n"
});

test("a main-navigation placement that isn't literal data is a finding instead of a missing parent", async () => {
  await withApp(placementApp([
    "function navLink(id, order, label, icon, suffix) {",
    "  return { id, target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"home\"], order, props: { label, icon, scopedSuffix: suffix, unscopedSuffix: suffix } };",
    "}",
    "addPlacement(navLink(\"app.books\", 10, \"Books\", \"$book\", \"/books\"));",
    "addPlacement({ ...BASE, id: \"app.shelves\", target: \"shell.primary-nav\", props: { scopedSuffix: \"/shelves\" } });",
    "addPlacement({ id: \"app.shelf\", target: \"shell.secondary-nav\", kind: \"link\", props: { scopedSuffix: `/shelves/${shelfId}` } });",
    ""
  ].join("\n")), async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/placement.js:2 nav/placement-data",
      "src/placement.js:5 nav/placement-data",
      "src/placement.js:6 nav/placement-data"
    ]);
    assert.deepEqual(result.findings.map(({ message }) => /literal data: (.+?)\. Declare/u.exec(message)?.[1]), [
      "its scopedSuffix is computed",
      "it spreads another object",
      "its scopedSuffix is computed"
    ]);
    assert.match(result.findings[0].message, /Declare each placement literally/u);
  });
  // Declared literally, both destinations are read and are top-level; a label's words are not link keys.
  await withApp(placementApp([
    "addPlacement({ id: \"app.books\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"home\"], order: 10, props: { label: \"Go to books...\", icon: \"$book\", surface: \"home\", scopedSuffix: \"/books\", unscopedSuffix: \"/books\" } });",
    "addPlacement({ id: \"app.shelves\", target: \"shell.primary-nav\", kind: \"link\", surfaces: [\"home\"], props: { label: t(\"nav.shelves\"), scopedSuffix: \"/shelves\" } });",
    ""
  ].join("\n")), async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
});

// A layout that draws its own top app bar (a workspace bar) from shell-web's pieces, through an app component.
const OWN_BAR_APP = {
  "package.json": SHELL_MANIFEST,
  "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.app = { id: \"app\", pagesRoot: \"app\" };\nconfig.surfaceDefinitions.bare = { id: \"bare\", pagesRoot: \"bare\" };\nexport { config };\n",
  "src/components/WorkspaceBar.vue": [
    "<script setup>",
    "import { ShellPageActionsTarget, ShellPageTitle, ShellUpButton, useShellAppBar } from \"@jskit-ai/shell-web/client\";",
    "useShellAppBar();",
    "</script>",
    "<template>",
    "  <v-app-bar>",
    "    <ShellUpButton />",
    "    <ShellPageTitle />",
    "    <ShellPageActionsTarget />",
    "  </v-app-bar>",
    "</template>",
    ""
  ].join("\n"),
  "src/components/StudioLayout.vue": "<script setup>\nimport WorkspaceBar from \"./WorkspaceBar.vue\";\n</script>\n<template>\n  <WorkspaceBar />\n  <v-main><slot /></v-main>\n</template>\n",
  "src/components/PlainLayout.vue": "<template>\n  <v-main><slot /></v-main>\n</template>\n",
  "src/pages/app.vue": "<route lang=\"json\">\n{ \"meta\": { \"jskit\": { \"surface\": \"app\" } } }\n</route>\n<script setup>\nimport StudioLayout from \"@/components/StudioLayout.vue\";\n</script>\n<template>\n  <StudioLayout>\n    <RouterView />\n  </StudioLayout>\n</template>\n",
  "src/pages/app/index.vue": "<template>\n  <section />\n</template>\n",
  "src/pages/app/projects/[slug].vue": "<template>\n  <section />\n</template>\n",
  "src/pages/app/projects/[slug]/run.vue": pageWith("definePage({ meta: { jskit: { parent: \"/projects/:slug\" } } });"),
  "src/pages/bare.vue": "<script setup>\nimport PlainLayout from \"@/components/PlainLayout.vue\";\n</script>\n<template>\n  <PlainLayout>\n    <RouterView />\n  </PlainLayout>\n</template>\n",
  "src/pages/bare/notes/[id].vue": "<template>\n  <section />\n</template>\n",
  "src/components/HandMadeUp.vue": [
    "<script setup>",
    "import { useShellNavigation } from \"@jskit-ai/shell-web/client\";",
    "const { up } = useShellNavigation();",
    "</script>",
    "<template>",
    "  <v-btn icon=\"$arrowBack\" aria-label=\"Back\" @click=\"up\" />",
    "</template>",
    ""
  ].join("\n")
};

test("a layout that draws its own top app bar with ShellUpButton is a shell layout, and only a hand-made Up is a back control", async () => {
  await withApp(OWN_BAR_APP, async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/components/HandMadeUp.vue:6 nav/back-control",
      "src/pages/app/projects/[slug].vue:1 nav/missing-parent"
    ]);
    assert.match(result.findings[0].message, /ShellUpButton in a bar the layout draws itself/u);
    assert.deepEqual(result.pages.map(({ route, topLevel, parent }) => [route, topLevel ? "top" : "", parent || ""].join(" ").trim()), [
      "/ top",
      "/projects/:slug",
      "/projects/:slug/run  own"
    ]);
  });
});

// Controls that read as back but navigate nothing in the app: prose, variables, an in-component step, a link within
// the page and a preview browser's Back and Forward through its frame's own history.
const NOT_BACK_PAGE = [
  "<script setup>",
  "import { computed, ref } from \"vue\";",
  "const frame = ref(null);",
  "const step = ref(1);",
  "const showBack = ref(false);",
  "const back = computed(() => step.value > 1);",
  "const rollBack = ref(false);",
  "function goPreviewBack() {",
  "  frame.value.contentWindow.history.back();",
  "}",
  "const goPreviewForward = () => frame.value?.contentWindow?.history.forward();",
  "function previousStep() {",
  "  step.value -= 1;",
  "}",
  "</script>",
  "<template>",
  "  <v-list-item>Back from version 2</v-list-item>",
  "  <v-chip @click=\"showBack = !showBack\">back from version 2</v-chip>",
  "  <v-btn icon=\"$arrowBack\" aria-label=\"Back\" @click=\"goPreviewBack\" />",
  "  <v-btn icon=\"$arrowForward\" aria-label=\"Forward\" @click=\"goPreviewForward()\" />",
  "  <v-btn prepend-icon=\"$arrowBack\" @click=\"previousStep\">Previous step</v-btn>",
  "  <v-btn :disabled=\"!back\" @click=\"rollBack = true\">Roll back</v-btn>",
  "  <a href=\"#top\">Back to top</a>",
  "  <iframe ref=\"frame\" title=\"Preview\" />",
  "</template>",
  ""
].join("\n");

test("nav/back-control flags controls that navigate the app, not prose, variables, steps or an embedded frame's history", async () => {
  await withApp({ "package.json": SHELL_MANIFEST, "src/components/PreviewBrowser.vue": NOT_BACK_PAGE }, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
  const navigating = NOT_BACK_PAGE
    .replace("frame.value.contentWindow.history.back();", "router.push(paths.page(\"/projects\"));")
    .replace("  step.value -= 1;", "  up();");
  await withApp({ "package.json": SHELL_MANIFEST, "src/components/PreviewBrowser.vue": navigating }, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), [
      "src/components/PreviewBrowser.vue:8 nav/back-control",
      "src/components/PreviewBrowser.vue:19 nav/back-control",
      "src/components/PreviewBrowser.vue:21 nav/back-control"
    ]);
  });
});

// A back component navigates by itself, so its tag is a back control without a link or handler, in either case; its
// import is one too. A back-to-top control and a back office are not.
test("nav/back-control flags back components in PascalCase and kebab case, and their imports", async () => {
  const page = [
    "<script setup>",
    "import ContextBackButton from \"@/components/navigation/ContextBackButton.vue\";",
    "import BackToTop from \"@/components/BackToTop.vue\";",
    "import BackOfficeCard from \"@/components/BackOfficeCard.vue\";",
    "import { useBackNavigation } from \"@/composables/useBackNavigation.js\";",
    "</script>",
    "<template>",
    "  <ContextBackButton />",
    "  <context-back-button />",
    "  <BackToTop />",
    "  <BackOfficeCard />",
    "</template>",
    ""
  ].join("\n");
  await withApp({ "package.json": SHELL_MANIFEST, "src/components/InvoicePanel.vue": page }, async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "src/components/InvoicePanel.vue:2 nav/back-control",
      "src/components/InvoicePanel.vue:8 nav/back-control",
      "src/components/InvoicePanel.vue:9 nav/back-control"
    ]);
    assert.match(result.findings[0].message, /^ContextBackButton is a back component\. Up belongs to the shell's top app bar/u);
    assert.match(result.findings[1].message, /^<context-back-button> is a back control\./u);
  });
});

// A layout that renders its pages without the shell on a shop device (a v-if beside the ShellLayout) leaves which
// of them show Up unreadable, so none needs a parent; a page that declares one still has its bar.
test("nav/missing-parent judges only pages that always render under the shell's top app bar", async () => {
  const layout = (template) => `<route lang="json">\n{ "meta": { "jskit": { "surface": "admin" } } }\n</route>\n<script setup>\nimport ShellLayout from "@/components/ShellLayout.vue";\nconst sharedDevice = false;\n</script>\n<template>\n${template}\n</template>\n`;
  const app = {
    "package.json": SHELL_MANIFEST,
    "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.admin = { id: \"admin\", pagesRoot: \"admin\" };\nexport { config };\n",
    "src/components/ShellLayout.vue": "<script setup>\nimport ShellLayout from \"@jskit-ai/shell-web/client/components/ShellLayout\";\n</script>\n<template>\n  <ShellLayout><slot /></ShellLayout>\n</template>\n",
    "src/pages/admin.vue": layout("  <v-main v-if=\"sharedDevice\">\n    <RouterView />\n  </v-main>\n  <ShellLayout v-else>\n    <RouterView />\n  </ShellLayout>"),
    "src/pages/admin/index.vue": "<template>\n  <section />\n</template>\n",
    "src/pages/admin/staff-sign-in.vue": "<template>\n  <section />\n</template>\n",
    "src/pages/admin/invoices/[id].vue": pageWith("definePage({ meta: { jskit: { parent: \"/\" } } });")
  };
  await withApp(app, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
  // Under a layout whose every RouterView is inside the ShellLayout, the same inner page needs its parent.
  await withApp({ ...app, "src/pages/admin.vue": layout("  <ShellLayout>\n    <RouterView />\n  </ShellLayout>") }, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), [
      "src/pages/admin/staff-sign-in.vue:1 nav/missing-parent"
    ]);
  });
});

// The record that carries jskit.surface is where Up stops, so the shell never reads a parent declared beside it.
test("nav/surface-parent flags a parent declared beside a surface, and the layout plus page form passes", async () => {
  const route = (meta) => `<route lang="json">\n${JSON.stringify({ meta: { jskit: meta } })}\n</route>\n`;
  const shellPage = (meta) => `${route(meta)}<script setup>\nimport ShellLayout from "@/components/ShellLayout.vue";\n</script>\n<template>\n  <ShellLayout>\n    <RouterView />\n  </ShellLayout>\n</template>\n`;
  const app = {
    "package.json": SHELL_MANIFEST,
    "config/public.js": "const config = {};\nconfig.surfaceDefinitions = {};\nconfig.surfaceDefinitions.home = { id: \"home\", pagesRoot: \"home\" };\nconfig.surfaceDefinitions.account = { id: \"account\", pagesRoot: \"account\" };\nexport { config };\n",
    "src/pages/home.vue": shellPage({ surface: "home" }),
    "src/pages/home/index.vue": "<template>\n  <section />\n</template>\n",
    "src/pages/account.vue": shellPage({ surface: "account", parent: { surface: "home", path: "/" } }),
    "src/pages/account/index.vue": "<template>\n  <section />\n</template>\n",
    // An inner page repeating its surface beside its parent is a surface root of its own, so it gets no Up either.
    "src/pages/home/contacts.vue": `${route({ surface: "home", parent: "/" })}<template>\n  <section />\n</template>\n`
  };
  await withApp(app, async (root) => {
    const result = await checkNavigation({ projectRoot: root });
    assert.deepEqual(findingLines(result), ["src/pages/account.vue:2 nav/surface-parent", "src/pages/home/contacts.vue:2 nav/surface-parent"]);
    const message = (file) => result.findings.find((finding) => finding.file === file).message;
    assert.match(message("src/pages/account.vue"), /never reads it[\s\S]*Declare the surface only on the surface's layout page[\s\S]*here, move jskit\.parent to the page this layout renders/u);
    assert.match(message("src/pages/home/contacts.vue"), /here, remove jskit\.surface and keep jskit\.parent/u);
  });
  // The surface only on the layout and the parent on the page it renders: Up on the account page reaches home.
  const fixed = {
    ...app,
    "src/pages/account.vue": shellPage({ surface: "account" }),
    "src/pages/account/index.vue": `${route({ parent: { surface: "home", path: "/" } })}<template>\n  <section />\n</template>\n`,
    "src/pages/home/contacts.vue": `${route({ parent: "/" })}<template>\n  <section />\n</template>\n`
  };
  await withApp(fixed, async (root) => {
    assert.deepEqual(findingLines(await checkNavigation({ projectRoot: root })), []);
  });
});

test("plain jskit check fails on navigation and visual findings after the package graph and passes once they are fixed", async () => {
  await withApp(PARENT_APP, async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^JSKIT project graph is coordinated across 1 manifest\(s\) and 0 resolved package installation\(s\)\.$/mu);
    assert.match(failure.stderr, /edit\.vue:2:\d+ {2}nav\/missing-parent {2}Inner page \/suppliers\/:supplierId\/edit of home has no parent/u);
    assert.match(failure.stderr, /material-3#what-an-app-declares/u);
    assert.match(failure.stderr, /^Material 3 check: 4 finding\(s\) in 4 of 23 file\(s\) of the whole app\. Exceptions: 0\.$/mu);

    const declare = (parent) => pageWith(`definePage({ meta: { jskit: { parent: "${parent}" } } });`);
    await writeFile(path.join(root, "src/pages/home/contacts/index.vue"), "<template>\n  <section />\n</template>\n");
    await writeFile(path.join(root, "src/pages/home/settings/general/index.vue"), declare("/"));
    await writeFile(path.join(root, "src/pages/home/suppliers/[supplierId]/edit.vue"), declare("/suppliers/:supplierId"));
    await writeFile(path.join(root, "src/pages/w/[workspaceSlug]/admin/jobs/[jobId]/index.vue"), declare("/jobs"));
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]);
    assert.match(stdout, /^Material 3 check: no findings in 23 file\(s\) of the whole app\. Exceptions: 0\.$/mu);

    // The visual rules fail it too: an outlined card.
    await writeFile(path.join(root, "src/pages/home/contacts/index.vue"), "<template>\n  <v-card variant=\"outlined\" />\n</template>\n");
    const visual = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(visual?.code, 1);
    assert.match(visual.stderr, /contacts\/index\.vue:2:\d+ {2}m3\/outlined-card {2}/u);
    assert.match(visual.stderr, /^Material 3 check: 1 finding\(s\) in 1 of 23 file\(s\) of the whole app\. Exceptions: 0\.$/mu);
  });
});

test("jskit check m3 parses as its own command and fails the CLI with the report", async () => {
  assert.deepEqual(parseArgs(["check", "m3", "src/pages/home", "--root", "/tmp/example"]), {
    command: "check-m3",
    paths: ["src/pages/home"],
    projectRoot: "/tmp/example"
  });
  assert.deepEqual(parseArgs(["check", "m3"]).paths, []);
  assert.throws(() => parseArgs(["check", "m3", "--manifest", "a/package.json"]), /only valid with jskit update and jskit check/u);
  assert.throws(() => parseArgs(["check", "m4"]), /Unknown argument: m4/u);
  assert.match(usage(), /jskit check m3 \[<path> \.\.\.\] \[--root <path>\]/u);

  await withApp(DRIFTING_APP, async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "m3", "src/pages", "--root", root])
      .then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /src\/pages\/home\/books\.vue:23:\d+ {2}nav\/history {2}router\.back\(/u);
    assert.match(failure.stderr, /guide\/framework\/material-3#forbidden-in-app-code/u);
    assert.match(failure.stderr, /^Exceptions \(1\):\nsrc\/pages\/home\/books\.vue:30 {2}m3\/raw-hex {2}the partner's logo colour is contractual$/mu);
    assert.match(failure.stderr, /Material 3 check: 27 finding\(s\) in 1 of 2 file\(s\) of the given paths\. Exceptions: 1\.$/mu);
  });
});
