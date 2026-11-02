import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describeSourceFile } from "../../../scripts/agent-docs-source-symbols.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function indexedTargets(source = "") {
  return [...String(source).matchAll(
    /^- (?:Read|Examples): \[[^\]]+\]\(([^)]+)\)$/gmu
  )].map((match) => match[1]);
}

async function assertIndexedTargetsExist(indexPath) {
  const source = await readFile(indexPath, "utf8");
  const targets = indexedTargets(source);
  assert.ok(targets.length > 0);
  assert.equal(targets.length % 2, 0);
  for (const target of targets) {
    await access(path.resolve(path.dirname(indexPath), decodeURIComponent(target)));
  }
  return source;
}

test("JSKIT documentation publishes complete pattern pages and self-contained indexes", async () => {
  const skill = await readFile(path.join(packageRoot, "skills/jskit/SKILL.md"), "utf8");
  const appOperations = await readFile(
    path.join(packageRoot, "skills/jskit/references/app-operations.md"),
    "utf8"
  );
  const patternIndex = await assertIndexedTargetsExist(
    path.join(packageRoot, "reference/autogen/PATTERN_INDEX.md")
  );
  const skillPatternIndex = await assertIndexedTargetsExist(
    path.join(packageRoot, "skills/jskit/references/pattern-index.md")
  );
  const publicPatternIndex = await readFile(
    path.join(packageRoot, "site/patterns/index.md"),
    "utf8"
  );
  const publicCrudPattern = await readFile(
    path.join(packageRoot, "site/patterns/crud/resource-contract.md"),
    "utf8"
  );
  const referenceIndex = await readFile(path.join(packageRoot, "reference/autogen/README.md"), "utf8");

  assert.match(skill, /Pattern-first implementation/);
  assert.match(skill, /references\/pattern-index\.md/);
  assert.match(skill, /do not install a runtime package merely to read them/u);
  assert.match(skill, /Do not write or consult receipts/);
  assert.match(skill, /There is no current JSKIT Doctor command/);
  assert.match(appOperations, /There is no supported `jskit doctor` command/);
  assert.match(appOperations, /Runtime startup owns the capability\/provider graph/);
  assert.match(appOperations, /bundled source pattern index/u);
  assert.doesNotMatch(`${skill}\n${appOperations}`, /scaffoldShape|scaffoldMode|feature-lane|handmade-feature|containerTokens/u);

  for (const index of [patternIndex, skillPatternIndex]) {
    assert.match(index, /crud\/resource-contract/);
    assert.doesNotMatch(index, /node_modules\/@jskit-ai\//u);
  }
  assert.match(patternIndex, /\.\.\/\.\.\/skills\/jskit\/references\/patterns\/crud\/resource-contract\/PATTERN\.md/u);
  assert.match(skillPatternIndex, /patterns\/crud\/resource-contract\/PATTERN\.md/u);
  assert.match(publicPatternIndex, /\[Owner-scoped CRUD resource contract\]\(\/patterns\/crud\/resource-contract\)/u);
  assert.match(publicCrudPattern, /# Owner-scoped CRUD resource contract/u);
  assert.match(publicCrudPattern, /Browse the complete example tree/u);
  assert.doesNotMatch(
    referenceIndex,
    /jskit-cli|create-app|crud-server-generator|feature-server-generator|crud-ui-generator|ui-generator/u
  );
});

test("a clean install of the packed agent-docs package has no dangling indexed paths", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-agent-docs-package-"));
  const packRoot = path.join(temporaryRoot, "pack");
  const fixtureRoot = path.join(temporaryRoot, "fixture");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(packRoot, { recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "agent-docs-clean-install", private: true }, null, 2)}\n`,
    "utf8"
  );

  const packed = await execFileAsync("npm", [
    "pack",
    "--json",
    "--pack-destination",
    packRoot,
  ], { cwd: packageRoot });
  const [{ filename }] = JSON.parse(packed.stdout);
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    path.join(packRoot, filename),
  ], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      npm_config_cache: path.join(temporaryRoot, "npm-cache"),
    },
  });

  const installedRoot = path.join(fixtureRoot, "node_modules/@jskit-ai/agent-docs");
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "node_modules/@jskit-ai"))).sort(),
    ["agent-docs"]
  );
  await assertIndexedTargetsExist(path.join(installedRoot, "reference/autogen/PATTERN_INDEX.md"));
  await assertIndexedTargetsExist(path.join(installedRoot, "skills/jskit/references/pattern-index.md"));
});

test("generated reference maps state the exclusions the generator actually applies", async () => {
  const excludesLine = (source) => source.match(/^- Excludes: .+$/mu)?.[0];
  const kernelMap = await readFile(path.join(packageRoot, "reference/autogen/KERNEL_MAP.md"), "utf8");
  const packageMap = await readFile(path.join(packageRoot, "reference/autogen/packages/kernel.md"), "utf8");

  assert.equal(excludesLine(kernelMap), excludesLine(packageMap));
  for (const excluded of ["node_modules/", ".jskit/", "skills/jskit/references/patterns/", "*.test.*", "*.vitest.*"]) {
    assert.ok(excludesLine(kernelMap).includes(`\`${excluded}\``), `Excludes line is missing ${excluded}.`);
  }
});

test("generated reference maps list the types a module declares with @typedef", () => {
  const typesModule = [
    "// The types of the booking capabilities, for features that require them.",
    "",
    "/** @typedef {ReturnType<typeof import(\"./bookingEngine.js\").createBookingEngine>} BookingEngine */",
    "/** @typedef {Readonly<Record<string, { id: string }>>} BookingIndex The bookings by id. */",
    "",
    "/**",
    " * The `booking.clock` contract.",
    " * @typedef {object} BookingClock",
    " * @property {() => Date} now",
    " */",
    "",
    "function createBookingIndex() {",
    "  /** @typedef {string} LocalOnly */",
    "  return {};",
    "}",
    "",
    "export { createBookingIndex };"
  ].join("\n");

  assert.deepEqual(describeSourceFile("types.js", typesModule), {
    exportedSymbols: ["createBookingIndex()", "type BookingEngine", "type BookingIndex", "type BookingClock"],
    localFunctions: []
  });
  assert.deepEqual(describeSourceFile("types.js", "/** @typedef {object} Empty */\n\nexport {};\n").exportedSymbols, [
    "type Empty"
  ]);
});

test("the JSKIT skill points at the bundled typed-features guide and heuristic", async () => {
  const skill = await readFile(path.join(packageRoot, "skills/jskit/SKILL.md"), "utf8");
  const guide = await readFile(path.join(packageRoot, "skills/jskit/references/typed-features.md"), "utf8");
  assert.ok(skill.includes("(references/typed-features.md)"), "SKILL.md does not link references/typed-features.md.");
  assert.match(skill, /\(references\/typed-features\.md\) and its heuristic/u, "SKILL.md does not point at the heuristic.");
  assert.match(skill, /Before writing server code, read \[typed features\]/u, "SKILL.md does not send server work to typed features first.");
  const guideIndex = await readFile(path.join(packageRoot, "site/guide/index.md"), "utf8");
  assert.match(guideIndex, /\[Typed features\]\(\/guide\/framework\/typed-features\): read before writing any\s+server/u);
  assert.ok(guide.includes("](heuristics/typed-features.md)"), "The bundled guide does not link its heuristic.");
  await access(path.join(packageRoot, "skills/jskit/references/heuristics/typed-features.md"));
  const heuristicsIndex = await readFile(path.join(packageRoot, "heuristics/INDEX.md"), "utf8");
  assert.match(heuristicsIndex, /\(\.\/typed-features\.md\)/u);
});

// The anchor VitePress gives a plain-words heading: lower case, each run of other characters one hyphen.
function headingAnchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function guideSections(guide) {
  return guide.split(/^## /mu).slice(1).map((chunk) => ({
    title: chunk.split("\n")[0],
    body: chunk,
    rules: chunk.split(/^### /mu).slice(1).map((rule) => ({ title: rule.split("\n")[0], body: rule }))
  }));
}

test("the typed-features guide gives each rule what, why and good and bad code", async () => {
  const guide = await readFile(path.join(packageRoot, "site/guide/framework/typed-features.md"), "utf8");
  const sections = guideSections(guide);
  assert.deepEqual(sections.map((section) => section.title), [
    "The rule",
    "Features",
    "Actions",
    "Services and repositories",
    "Errors",
    "Tests",
    "Files and layout",
    "Checks",
    "A whole feature"
  ]);
  const rules = sections.filter((section) => !["The rule", "Checks", "A whole feature"].includes(section.title)).flatMap((section) => section.rules);
  assert.ok(rules.length >= 30, "The guide lost rules.");
  for (const rule of rules) {
    assert.match(rule.body, /^\*\*[^*]/mu, `"${rule.title}" does not state what to do in bold.`);
    assert.match(rule.body, /^Why: \S/mu, `"${rule.title}" has no one-line why.`);
    assert.match(rule.body, /^(?:\/\/ )?good\b[\s\S]+^(?:\/\/ )?bad\b/mu, `"${rule.title}" has no good and bad example.`);
  }
  assert.doesNotMatch(guide, /\b(?:before|after):|console-core's|was converted|the port\b/iu, "The guide narrates history.");
  const checks = sections.find((section) => section.title === "Checks").body;
  for (const prefix of ["input validation:", "data:", "platform object:", "optional operation:", "safety invariant: <what goes wrong>", "not a slot:", "deferred until boot: <reason>", "cycle: <supplier> requires <owner>"]) {
    assert.ok(checks.includes(`| \`${prefix}\``), `Checks lacks the ${prefix} prefix.`);
  }
  assert.match(checks, /platform object: a Knex transaction/u);
});

test("every typed-features lint rule links a guide section and is listed in its checks", async () => {
  const { jskitPlugin } = await import("@jskit-ai/config-eslint/server");
  const guide = await readFile(path.join(packageRoot, "site/guide/framework/typed-features.md"), "utf8");
  const anchors = new Set([...guide.matchAll(/^#{2,3} (.+)$/gmu)].map((match) => headingAnchor(match[1])));
  const lintTable = guide.slice(guide.indexOf("### Lint rules"), guide.indexOf("### Exceptions"));
  for (const [name, rule] of Object.entries(jskitPlugin.rules)) {
    const url = rule.meta.docs.url;
    assert.match(url, /^https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/typed-features#/u, name);
    const anchor = url.split("#")[1];
    assert.ok(anchors.has(anchor), `jskit/${name} links #${anchor}, which no heading has.`);
    assert.ok(lintTable.includes(`| \`jskit/${name}\` |`), `The lint rules table lacks jskit/${name}.`);
    assert.ok(lintTable.includes(`(#${anchor})`), `The lint rules table does not send jskit/${name} to #${anchor}.`);
    for (const message of Object.values(rule.meta.messages)) {
      assert.ok(message.endsWith(` See ${url}`), `A jskit/${name} message does not end with its guide link.`);
    }
  }
});

test("the typed-features heuristic sends each keyword to a guide section", async () => {
  const guide = await readFile(path.join(packageRoot, "site/guide/framework/typed-features.md"), "utf8");
  const anchors = new Set([...guide.matchAll(/^#{2,3} (.+)$/gmu)].map((match) => headingAnchor(match[1])));
  const heuristic = await readFile(path.join(packageRoot, "heuristics/typed-features.md"), "utf8");
  const links = [...heuristic.matchAll(/\(\.\.\/site\/guide\/framework\/typed-features\.md#([^)]+)\)/gu)].map((match) => match[1]);
  assert.ok(links.length >= 30, "The heuristic lost its keyword map.");
  for (const anchor of links) {
    assert.ok(anchors.has(anchor), `The heuristic links #${anchor}, which no heading has.`);
  }
  for (const keyword of [
    "`capability.service || capability`",
    "`async execute`",
    "`(...args: any[]) => Promise<any>`",
    "`...factory(…)`",
    "`payload = {}`",
    "`logger = null`",
    "`context?.actor`",
    "`X | null`",
    "`deferred until boot: <reason>`",
    "`optional operation:` on a method every implementer has",
    "`env = process.env`",
    "`idempotency:`",
    "`Object.assign(new Error(…), { statusCode })`"
  ]) {
    assert.ok(heuristic.includes(keyword), `The heuristic lacks ${keyword}.`);
  }
  assert.doesNotMatch(heuristic, /^\| Reason prefix/mu, "The heuristic copies the guide's exceptions table.");
});

test("JSKIT guidance does not assume a project blueprint or page generator", async () => {
  for (const relativePath of [
    "heuristics/surfaces.md",
    "heuristics/page-scaffolding.md",
    "site/guide/framework/application-operations.md",
    "skills/jskit/references/app-operations.md"
  ]) {
    const source = await readFile(path.join(packageRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /blueprint|Genesis|generating (?:pages|routes)/iu, relativePath);
  }
});
