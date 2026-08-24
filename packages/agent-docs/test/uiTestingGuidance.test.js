import assert from "node:assert/strict";
import { access, cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPERATIONAL_REFERENCE_FILES = Object.freeze([
  "app-operations.md",
  "crud-operations.md",
  "material-3.md",
  "ui-operations.md",
]);

async function collectMarkdownFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(location);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(location);
      }
    }
  }
  await visit(root);
  return files.sort();
}

function relativeMarkdownLinks(source) {
  const destinations = [
    ...source.matchAll(/!?\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/gu),
    ...source.matchAll(/^\s*\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gmu),
  ].map((match) => match[1] || match[2]);
  return destinations.filter((destination) => (
    destination
    && !destination.startsWith("#")
    && !destination.startsWith("?")
    && !destination.startsWith("/")
    && !/^[a-z][a-z\d+.-]*:/iu.test(destination)
  ));
}

test("the single JSKIT skill is pattern-first and contains no generator or receipt lane", async () => {
  const skillRoot = path.join(packageRoot, "skills/jskit");
  const referencesRoot = path.join(skillRoot, "references");
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const referenceFiles = (await readdir(referencesRoot)).sort();
  const references = await Promise.all(referenceFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(referencesRoot, file), "utf8"),
  })));
  const operationalReferences = references.filter(({ file }) => OPERATIONAL_REFERENCE_FILES.includes(file));
  const operationalSource = [skill, ...operationalReferences.map(({ source }) => source)].join("\n");

  assert.deepEqual(referenceFiles, [
    "app-operations.md",
    "crud-operations.md",
    "existing-application-migration.md",
    "material-3.md",
    "pattern-index.md",
    "ui-operations.md",
  ]);
  for (const file of referenceFiles) {
    assert.match(skill, new RegExp(`\\(references/${file.replace(".", "\\.")}\\)`, "u"));
  }
  const localLinks = [...skill.matchAll(/\[[^\]\n]*\]\(([^)]+)\)/gu)].map((match) => match[1]);
  assert.deepEqual(localLinks.sort(), referenceFiles.map((file) => `references/${file}`).sort());
  assert.equal(references.every(({ source }) => !/\[[^\]\n]*\]\((?!https?:|mailto:|#)[^)]+\)/u.test(source)), true);

  assert.match(operationalSource, /current diff/);
  assert.match(operationalSource, /app\/shell-foundation/u);
  assert.match(operationalSource, /app\/minimal-foundation/u);
  assert.match(operationalSource, /crud\/resource-contract/u);
  assert.match(operationalSource, /JSKIT has no general authoring CLI/u);
  assert.match(operationalSource, /Install one planned dependency closure/u);
  assert.match(operationalSource, /(?:author|write) an immutable.*migration/iu);
  assert.match(operationalSource, /defineCrudResource\(\)/u);
  assert.match(operationalSource, /Use semantic placement ids/u);
  assert.match(operationalSource, /route\s+template or relative string raw to Vue Router `to`/u);
  assert.match(skill, /Caller-owned verification/u);
  assert.match(skill, /Do not start a dev server/u);
  assert.match(skill, /Review or deslop/u);
  assert.match(skill, /complete operational references\s+required by this skill/u);
  assert.match(skill, /Do not load\s+irrelevant references/u);
  const crudReference = references.find(({ file }) => file === "crud-operations.md").source;
  const materialReference = references.find(({ file }) => file === "material-3.md").source;
  const uiReference = references.find(({ file }) => file === "ui-operations.md").source;
  assert.match(crudReference, /Do not translate the work into generator options/u);
  assert.match(crudReference, /Never make a live table or a generator the sole source of truth/u);
  assert.match(uiReference, /Resolve current dynamic parameters\s+to an absolute URL or route object/u);
  assert.match(skill, /every Vue\/Vuetify UI creation, modification, review, or deslop task/u);
  assert.match(skill, /Material 3 audit/u);
  assert.match(materialReference, /Use the installed public APIs rather than adding `@material\/web`/u);
  assert.match(materialReference, /central `createVuetify\(\.\.\.\)` configuration/u);
  assert.match(materialReference, /Use elevation `0` through `5`/u);
  assert.match(materialReference, /at least\s+48 CSS-pixel interactive targets/u);
  assert.match(materialReference, /resource that cannot render uses a\s+stable in-page error and retry state/u);
  assert.match(materialReference, /user-triggered command uses JSKIT's shared action\s+feedback\/snackbar path/u);
  assert.match(materialReference, /Never insert a transient command-error alert above\s+page content where it shifts the working layout/u);
  assert.match(materialReference, /All user-visible\s+loading uses Material skeletons that reserve the final content geometry/u);
  assert.match(materialReference, /never use a generic spinner or circular progress indicator/u);
  assert.match(materialReference, /stable disabled\/pending label and shared feedback, not a spinner/u);
  assert.match(materialReference, /Playwright at compact, medium, and expanded widths/u);
  assert.match(materialReference, /Do not declare Material 3 compliance from visual resemblance alone/u);
  assert.doesNotMatch(operationalSource, /@jskit-ai\/create-app|crud-server-generator|crud-ui-generator|ui-generator/u);
  assert.doesNotMatch(operationalSource, /\.jskit\/APP_BLUEPRINT|\.jskit\/WORKBOARD/u);
  assert.doesNotMatch(
    references.map(({ source }) => source).join("\n"),
    /(?:^|[\s`(])\.\.\//mu
  );
  assert.doesNotMatch(operationalSource, /(?:^|[\s`(])(?:patterns|guide\/agent|site\/guide)\//mu);
  assert.ok(Buffer.byteLength(operationalSource) <= 20 * 1024);
  assert.ok(Buffer.byteLength([skill, uiReference, materialReference].join("\n")) <= 13 * 1024);
});

test("the published JSKIT skill remains self-contained after relocation", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-skill-relocation-"));
  const relocatedSkillRoot = path.join(temporaryRoot, "jskit");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(packageRoot, "skills/jskit"), relocatedSkillRoot, { recursive: true });

  for (const markdownFile of await collectMarkdownFiles(relocatedSkillRoot)) {
    const source = await readFile(markdownFile, "utf8");
    for (const destination of relativeMarkdownLinks(source)) {
      const encodedPath = destination.split(/[?#]/u, 1)[0];
      const target = path.resolve(path.dirname(markdownFile), decodeURIComponent(encodedPath));
      const relativeTarget = path.relative(relocatedSkillRoot, target);
      assert.equal(
        relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget),
        false,
        `${path.relative(relocatedSkillRoot, markdownFile)} links outside the skill: ${destination}`
      );
      await access(target);
    }
  }
});

test("UI testing guidance uses private local exchange support and managed storage state", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/ui-testing.md"), "utf8");
  const humanGuide = await readFile(path.join(packageRoot, "site/guide/app-setup/authentication.md"), "utf8");
  const distributedGuide = await readFile(path.join(packageRoot, "guide/agent/app-setup/authentication.md"), "utf8");

  for (const source of [pattern, humanGuide, distributedGuide]) {
    assert.match(source, /@jskit-ai\/auth-web\/test\/playwright/u);
    assert.match(source, /x-jskit-dev-auth-secret/u);
    assert.match(source, /VIBE64_PLAYWRIGHT_STORAGE_STATE/u);
    assert.doesNotMatch(source, /page\.evaluate\(async/u);
    assert.doesNotMatch(source, /fetch\("\/api\/dev-auth\/login-as"/u);
  }
});

test("app-owned baseline tests are customizable but remain verified", async () => {
  const relativePaths = [
    "patterns/ui-testing.md",
    "skills/jskit/references/ui-operations.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );

  for (const source of sources) {
    assert.match(source, /App-owned.*customizable|application-owned.*customizable|ordinary customizable application source/is);
    assert.match(source, /adapt.*(?:in place|smoke test)/is);
    assert.match(source, /canonical route/is);
    assert.match(source, /browser\s+coverage/is);
  }

  assert.match(sources[0], /tests\/e2e\/base-shell\.spec\.ts/);
  assert.match(sources[0], /tests\/e2e\/adaptive-shell\.spec\.ts/);
});

test("adaptive drawer guidance documents Vuetify rail and compact close behavior", async () => {
  const humanGuide = await readFile(
    path.join(packageRoot, "site/guide/app-setup/a-more-interesting-shell.md"),
    "utf8"
  );
  const skillReference = await readFile(
    path.join(packageRoot, "skills/jskit/references/ui-operations.md"),
    "utf8"
  );

  for (const source of [humanGuide, skillReference]) {
    assert.match(source, /Vuetify/);
    assert.match(source, /compact.*close|compact\/mobile.*closes/is);
    assert.match(source, /desktopDrawerClosedMode|desktop-drawer-closed-mode/);
    assert.match(source, /drawerWidth|drawer-width/);
    assert.match(source, /railWidth|rail-width/);
    assert.match(source, /navigationItemSpacing|navigation-item-spacing/);
    assert.match(source, /12 CSS pixels|12px/);
    assert.match(source, /rail/);
    assert.match(source, /hidden/);
  }
});
