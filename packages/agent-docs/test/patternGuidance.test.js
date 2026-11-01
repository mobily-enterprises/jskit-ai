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

test("the typed-features guide states its rules and common mistakes as headings", async () => {
  const guide = await readFile(path.join(packageRoot, "site/guide/framework/typed-features.md"), "utf8");
  const headings = (level) => [...guide.matchAll(new RegExp(`^${"#".repeat(level)} (.+)$`, "gmu"))].map((match) => match[1]);
  const section = (title) => guide.slice(guide.indexOf(`## ${title}\n`), guide.indexOf("\n## ", guide.indexOf(`## ${title}\n`) + 1));

  assert.deepEqual(headings(2), ["The rule", "Rules", "Common mistakes", "One feature end to end", "Checks"]);
  assert.deepEqual([...section("Rules").matchAll(/^### (.+)$/gmu)].map((match) => match[1]), [
    "1. A provided capability exports its type",
    "2. A received collaborator is typed where it is received",
    "3. Collaborators are required",
    "4. Extension slots are optional capabilities",
    "5. Actions are one line",
    "6. Methods take the validated input as it is",
    "7. One request-context form per package",
    "8. Factory results are frozen, with named members",
    "9. One copy of each helper, concern-sized files",
    "10. Names and comments"
  ]);
  const mistakes = [...section("Common mistakes").matchAll(/^### (.+)$/gmu)].map((match) => match[1]);
  for (const mistake of [
    "A collaborator accepted in two shapes \"for tests\"",
    "A probe on a collaborator that is always present",
    "An action built by a helper, given a body, or stripped by a helper",
    "A hand-written `(...args: any[]) => Promise<any>` interface",
    "Spreading an in-package factory into a token value",
    "`= {}` on contract operations",
    "Input re-parsed after the schema validated it",
    "Several request-context forms in one package",
    "Unfrozen results",
    "The same indexed type spelled out at every use",
    "A guard or comment that cites tests"
  ]) {
    assert.ok(mistakes.includes(mistake), `Common mistakes lacks "${mistake}".`);
  }
  for (const rule of section("Rules").split(/^### /mu).slice(1)) {
    assert.match(rule, /\/\/ before[^\n]*\n[\s\S]+\/\/ after/u, `Rule "${rule.split("\n")[0]}" has no before and after.`);
  }
  for (const prefix of ["input validation:", "data:", "platform object:", "optional operation:", "safety invariant: <what goes wrong>", "not a slot:", "deferred until boot: <reason>", "cycle: <supplier> requires <owner>"]) {
    assert.ok(section("Checks").includes(`| \`${prefix}\``), `Checks lacks the ${prefix} prefix.`);
  }
  assert.match(section("Checks"), /platform object: a Knex transaction/u);
});

test("the typed-features heuristic maps the common mistakes to their fixes", async () => {
  const heuristic = await readFile(path.join(packageRoot, "heuristics/typed-features.md"), "utf8");
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
    "(../site/guide/framework/typed-features.md#common-mistakes)"
  ]) {
    assert.ok(heuristic.includes(keyword), `The heuristic lacks ${keyword}.`);
  }
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
