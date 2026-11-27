import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const siteRoot = path.join(packageRoot, "site");
const recipesRoot = path.join(siteRoot, "guide", "recipes");

// Each recipe and whether it builds something or is a study that changes nothing and ends in a plan.
const RECIPES = Object.freeze({
  "installable-app": "build",
  "offline-study": "study",
  "usefulness-study": "study",
  "payments-and-subscriptions": "build",
  "invite-people-with-roles": "build",
  "file-uploads-and-images": "build",
  "reminders-and-digests": "build",
  "another-language": "build"
});

// The shape every recipe is pasted into a session with, in this order.
const SECTIONS = Object.freeze([
  "When to propose it",
  "How to answer the person",
  "Product decisions (defaults)",
  "Make a careful saved plan first",
  "Technical details",
  "Proof",
  "Leftovers for the person"
]);

const OTHER_OPTIONS = "There are other options if you want to discuss";

function headingAnchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function stripFrontMatter(source) {
  return source.replace(/^---\n[\s\S]*?\n---\n/u, "");
}

function section(source, title) {
  const start = source.indexOf(`\n## ${title}\n`);
  if (start < 0) {
    return "";
  }
  const rest = source.slice(start + title.length + 5);
  const end = rest.search(/^## /mu);
  return end < 0 ? rest : rest.slice(0, end);
}

async function recipe(name) {
  return readFile(path.join(recipesRoot, `${name}.md`), "utf8");
}

async function pageAnchors(linkPath) {
  const relative = linkPath.replace(/^\//u, "").replace(/\/$/u, "/index");
  const source = await readFile(path.join(siteRoot, `${relative}.md`), "utf8");
  return new Set([...source.matchAll(/^#{1,4} (.+)$/gmu)].map((match) => headingAnchor(match[1])));
}

async function workspacePackageNames() {
  const names = new Set();
  for (const group of ["packages", "tooling"]) {
    for (const entry of await readdir(path.join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(path.join(repoRoot, group, entry.name, "package.json"), "utf8"));
        names.add(manifest.name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return names;
}

test("the recipes are exactly the eight pages the guide index lists, each with its one-line use when", async () => {
  const files = (await readdir(recipesRoot)).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3)).sort();
  assert.deepEqual(files, Object.keys(RECIPES).sort());
  const index = await readFile(path.join(siteRoot, "guide", "index.md"), "utf8");
  const recipes = section(index, "Recipes");
  assert.ok(recipes, "The guide index has a Recipes section.");
  assert.match(recipes, /propose the simple way first/u, "The Recipes section says how to answer the person.");
  for (const name of Object.keys(RECIPES)) {
    const line = recipes.split(/\n(?=- )/u).find((entry) => entry.includes(`](/guide/recipes/${name})`));
    assert.ok(line, `The guide index lists ${name}.`);
    assert.match(line.replace(/\s+/gu, " "), /\): use when .{20,}/u, `${name}'s index line says when to use it.`);
  }
});

test("every recipe has the shape a session is given: outcome, when, the answer, decisions, a saved plan, details, proof, leftovers", async () => {
  for (const [name, kind] of Object.entries(RECIPES)) {
    const source = stripFrontMatter(await recipe(name));
    const [title, ...rest] = source.trim().split("\n");
    assert.match(title, /^# .*`<APP_NAME>`/u, `${name} opens with a title naming \`<APP_NAME>\`.`);
    const outcome = rest.join("\n").trim().split(/\n\n/u)[0];
    assert.ok(outcome && !outcome.startsWith("#") && outcome.length > 120, `${name} opens with a paragraph of outcome.`);
    const headings = [...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
    const expected = kind === "study" ? [...SECTIONS.slice(0, -1), "The plan it ends in", "Leftovers for the person"] : SECTIONS;
    assert.deepEqual(headings, expected, `${name} has the recipe's sections in order.`);
    const answer = section(source, "How to answer the person");
    assert.ok(answer.includes(OTHER_OPTIONS), `${name} answers the simple way first, then offers the other options.`);
    assert.ok(answer.indexOf(OTHER_OPTIONS) > 200, `${name} gives the simple way before the other options.`);
    assert.match(section(source, "Make a careful saved plan first"), /^1\. /mu, `${name}'s plan is a numbered checklist.`);
    if (kind === "study") {
      assert.match(source, /changes nothing/u, `${name} says the study changes nothing.`);
      assert.match(section(source, "The plan it ends in"), /recommend/iu, `${name} ends in a recommended plan.`);
    } else {
      assert.match(section(source, "Proof"), /never against development data/u, `${name} keeps proof off development data.`);
    }
  }
});

test("a recipe's links reach real guide sections and patterns, and every package it names is a JSKIT package", async () => {
  const packages = await workspacePackageNames();
  for (const name of Object.keys(RECIPES)) {
    const source = await recipe(name);
    for (const [, linkPath, anchor] of source.matchAll(/\]\((\/(?:guide|patterns)\/[^)#\s]*)(?:#([^)\s]+))?\)/gu)) {
      const anchors = await pageAnchors(linkPath).catch(() => null);
      assert.ok(anchors, `${name} links ${linkPath}, which is no page.`);
      if (anchor) {
        assert.ok(anchors.has(anchor), `${name} links ${linkPath}#${anchor}, which no heading has.`);
      }
    }
    for (const [packageName] of source.matchAll(/@jskit-ai\/[a-z0-9-]+/gu)) {
      assert.ok(packages.has(packageName), `${name} names ${packageName}, which is no JSKIT package.`);
    }
  }
});

test("recipe pages build as VitePress pages: placeholders and tags stay inside code", async () => {
  for (const name of Object.keys(RECIPES)) {
    const prose = (await recipe(name)).replace(/```[\s\S]*?```/gu, "").replace(/`[^`\n]*`/gu, "");
    assert.doesNotMatch(prose, /<[A-Za-z_/]/u, `${name} has a tag or placeholder outside code, which VitePress would compile.`);
    assert.doesNotMatch(prose, /\{\{/u, `${name} has a mustache outside code, which VitePress would compile.`);
  }
});

test("the installable app answers with the website install first and Capacitor packaging as the other option", async () => {
  const installable = await recipe("installable-app");
  const answer = section(installable, "How to answer the person");
  const other = answer.slice(answer.indexOf(OTHER_OPTIONS));
  assert.match(other, /\]\(\/guide\/app-extras\/mobile-capacitor\)/u, "The other option links the Mobile Capacitor guide.");
  assert.match(other, /Packaging/u, "The other option names the host's Packaging.");
  for (const kept of ["15 seconds", "`APP_ENV=production`", "`logSideEffect`", "Send a test notification", "`claim(", "`expectFlatQueries()`",
    "`serviceWorkers: \"block\"`", "409", "410", "focus-existing", "maskable", "`share_target`"]) {
    assert.ok(installable.includes(kept), `The installable app keeps ${kept}.`);
  }
  const capacitor = await readFile(path.join(siteRoot, "guide", "app-extras", "mobile-capacitor.md"), "utf8");
  assert.match(capacitor, /\]\(\/guide\/recipes\/installable-app\)/u, "Mobile Capacitor points at the installable app first.");
  await access(path.join(packageRoot, "guide", "agent", "recipes", "installable-app.md"));
});
