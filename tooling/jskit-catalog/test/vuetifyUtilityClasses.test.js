import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", ".vite", ".vitepress"]);

// The layout utility families Vuetify's own classes are named in: display, flex, gap and spacing. A class of one of
// these names that Vuetify's stylesheet doesn't define styles nothing (d-grid left the sign-in page's provider buttons
// touching), and the page still renders, so nothing else notices.
const VUETIFY_LAYOUT_UTILITY = /^(?:d|flex|justify|align|order|ga|gr|gc)-|^[mp][atbrlsexy]?-/u;

async function vueFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return vueFiles(full);
    return entry.name.endsWith(".vue") ? [full] : [];
  }));
  return nested.flat();
}

// The classes the stylesheet apps load ("vuetify/styles") defines, as the installed Vuetify ships it.
async function vuetifyClasses() {
  const css = await readFile(fileURLToPath(import.meta.resolve("vuetify/styles")), "utf8");
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/gu)].map(([, name]) => name));
}

const lineAt = (source, index) => source.slice(0, index).split("\n").length;

// Each class a template names: its static class attributes, and the quoted names in its :class bindings.
function templateClasses(source) {
  const start = source.indexOf("<template");
  const end = source.lastIndexOf("</template>");
  if (start < 0 || end < start) return [];
  const found = [];
  const template = source.slice(start, end);
  for (const match of template.matchAll(/(?<![\w:-])(:|v-bind:)?class\s*=\s*"([^"]*)"/gu)) {
    const valueIndex = start + match.index + match[0].indexOf("\"") + 1;
    const names = match[1]
      ? [...match[2].matchAll(/'([^']*)'|`([^`$]*)`/gu)].flatMap((literal) => literal[1] ?? literal[2] ?? "").join(" ")
      : match[2];
    for (const name of names.split(/\s+/u).filter(Boolean)) {
      found.push({ name, line: lineAt(source, valueIndex) });
    }
  }
  return found;
}

// The classes a component's own <style> defines, which a template may name as it likes.
function ownStyleClasses(source) {
  return new Set([...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gu)]
    .flatMap(([, css]) => [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/gu)].map(([, name]) => name)));
}

test("every Vuetify layout utility class a JSKIT template names is one the installed Vuetify ships", async () => {
  const shipped = await vuetifyClasses();
  // The stylesheet read is Vuetify's utilities: a wrong file would make every name below a finding, or none.
  for (const name of ["d-flex", "flex-column", "ga-2", "mb-4", "d-sm-none"]) assert.ok(shipped.has(name), `vuetify/styles defines .${name}`);

  const files = [
    ...await vueFiles(path.join(REPO_ROOT, "packages")),
    ...await vueFiles(path.join(REPO_ROOT, "tooling"))
  ].sort();
  const unknown = [];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const own = ownStyleClasses(source);
    for (const { name, line } of templateClasses(source)) {
      if (!VUETIFY_LAYOUT_UTILITY.test(name)) continue;
      checked += 1;
      if (!shipped.has(name) && !own.has(name)) unknown.push(`${path.relative(REPO_ROOT, file)}:${line} ${name}`);
    }
  }

  // The scan reads JSKIT's components: a scan that finds none would pass on any class.
  assert.ok(files.length > 100, `found ${files.length} .vue files`);
  assert.ok(checked > 500, `checked ${checked} layout utility classes`);
  assert.deepEqual(unknown, [], "Vuetify ships no such class, so it styles nothing. Use one it ships (for a stack with gaps, d-flex flex-column ga-2).");
});

test("the template scan reads static class attributes and the quoted names of :class bindings", () => {
  const source = [
    "<script setup>",
    "const html = '<div class=\"d-script\"></div>';",
    "</script>",
    "<template>",
    "  <div class=\"d-grid ga-2\" data-class=\"d-data\">",
    "    <span :class=\"{ 'd-inline-grid': wide, plain }\" />",
    "    <span v-bind:class=\"[`flex-col`, compact ? 'pa-2' : 'pa-big']\" />",
    "  </div>",
    "</template>",
    "<style scoped>",
    ".pa-big { padding: 2rem; }",
    "</style>"
  ].join("\n");
  assert.deepEqual(templateClasses(source).map(({ name, line }) => `${line} ${name}`), [
    "5 d-grid",
    "5 ga-2",
    "6 d-inline-grid",
    "7 flex-col",
    "7 pa-2",
    "7 pa-big"
  ]);
  assert.deepEqual([...ownStyleClasses(source)], ["pa-big"]);
});
