import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { ESLint } from "eslint";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const PATTERNS_ROOT = path.join(PACKAGE_ROOT, "patterns");
const FOUNDATION_NAMES = Object.freeze(["minimal-foundation", "shell-foundation"]);

let playwrightConfigLoads = 0;

/**
 * A foundation's Playwright configuration as a run with `env` would load it. The config is imported afresh (a new
 * URL) with that environment in place, then the environment is put back as it was; the modules it imports load once,
 * as browserTestConfig reads the environment when the config calls it.
 */
async function loadPlaywrightConfig(patternName, env) {
  const configPath = path.join(PATTERNS_ROOT, patternName, "example", "playwright.config.mjs");
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const url = `${pathToFileURL(configPath).href}?load=${++playwrightConfigLoads}`;
    const { default: config } = await import(url);
    return JSON.parse(JSON.stringify({
      webServer: config.webServer ?? null,
      baseURL: config.use.baseURL,
      workers: config.workers,
      globalTimeout: config.globalTimeout
    }));
  } finally {
    for (const name of Object.keys(process.env)) {
      if (!Object.hasOwn(saved, name)) delete process.env[name];
    }
    Object.assign(process.env, saved);
  }
}

async function collectFiles(rootDirectory) {
  const files = [];

  async function walk(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  await walk(rootDirectory);
  return files;
}

async function readExamplePackageJson(patternName) {
  const source = await readFile(
    path.join(PATTERNS_ROOT, patternName, "example", "package.json"),
    "utf8"
  );
  return JSON.parse(source);
}

async function readExampleMainPackageJson(patternName) {
  const source = await readFile(
    path.join(PATTERNS_ROOT, patternName, "example", "packages", "main", "package.json"),
    "utf8"
  );
  return JSON.parse(source);
}

async function readWorkspacePackageVersion(packageDirectory, workspaceRoot = "packages") {
  const source = await readFile(
    path.join(REPOSITORY_ROOT, workspaceRoot, packageDirectory, "package.json"),
    "utf8"
  );
  return JSON.parse(source).version;
}

test("application foundations are concrete source patterns rather than generator templates", async () => {
  const kernelVersion = await readWorkspacePackageVersion("kernel");
  const httpRuntimeVersion = await readWorkspacePackageVersion("http-runtime");
  const catalogVersion = await readWorkspacePackageVersion("jskit-catalog", "tooling");

  for (const patternName of FOUNDATION_NAMES) {
    const patternRoot = path.join(PATTERNS_ROOT, patternName);
    const exampleRoot = path.join(patternRoot, "example");
    const files = await collectFiles(exampleRoot);
    const packageJson = await readExamplePackageJson(patternName);
    const mainPackageJson = await readExampleMainPackageJson(patternName);

    assert.equal(packageJson.name, "reading-room");
    assert.equal(packageJson.private, true);
    assert.deepEqual(packageJson.workspaces, ["packages/*"]);
    assert.equal(packageJson.dependencies?.[mainPackageJson.name], mainPackageJson.version);
    assert.doesNotMatch(JSON.stringify(packageJson), /"file:/u);
    assert.equal(packageJson.dependencies?.["@jskit-ai/kernel"], kernelVersion);
    assert.equal(packageJson.dependencies?.["@jskit-ai/http-runtime"], httpRuntimeVersion);
    assert.equal(packageJson.devDependencies?.["@jskit-ai/jskit-catalog"], catalogVersion);
    assert.equal(packageJson.devDependencies?.["@jskit-ai/agent-docs"], undefined);
    assert.equal(packageJson.devDependencies?.["@jskit-ai/jskit-cli"], undefined);
    assert.equal(
      packageJson.scripts?.["jskit:update"],
      "npx --yes @jskit-ai/jskit-catalog@latest update"
    );
    assert.equal(packageJson.scripts?.["jskit:check"], "jskit check");
    // The whole suite, every section once: the browser suite builds the production frontend it serves, so no
    // separate build runs.
    assert.equal(packageJson.scripts?.verify,
      "npm run jskit:check && npm run lint && npm run test && npm run test:client && npm run test:e2e");
    assert.ok(files.length > 25, `${patternName} must remain a coherent application tree.`);

    const combinedSource = (
      await Promise.all(files.map(async (filePath) => {
        if (/\.(?:svg|png|jpg|jpeg|gif|ico)$/u.test(filePath)) {
          return "";
        }
        return readFile(filePath, "utf8");
      }))
    ).join("\n");

    assert.doesNotMatch(combinedSource, /__(?:APP|PLAYWRIGHT|TENANCY)[A-Z_]*__/u);
    assert.doesNotMatch(combinedSource, /feature-server-generator/u);
    assert.doesNotMatch(combinedSource, /\.generated-ui-screen/u);
    assert.doesNotMatch(combinedSource, /run `?create-app|npx @jskit-ai\/create-app/u);

    // An example carries no host state directory.
    assert.equal(
      files.some((filePath) => path.relative(exampleRoot, path.dirname(filePath)).split(path.sep).some((part) => part.startsWith("."))),
      false
    );
  }
});

test("foundation JavaScript entrypoints parse as executable source", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const exampleRoot = path.join(PATTERNS_ROOT, patternName, "example");
    for (const relativePath of ["bin/develop.js", "bin/server.js", "server.js", "src/main.js"]) {
      await execFileAsync(process.execPath, ["--check", path.join(exampleRoot, relativePath)]);
    }
  }
});

test("application foundations own one exact development command", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const exampleRoot = path.join(PATTERNS_ROOT, patternName, "example");
    const packageJson = await readExamplePackageJson(patternName);
    const developSource = await readFile(path.join(exampleRoot, "bin", "develop.js"), "utf8");

    assert.equal(packageJson.scripts?.develop, "node ./bin/develop.js");
    assert.match(developSource, /VITE_API_PROXY_TARGET/u);
    assert.match(developSource, /--strictPort/u);
    assert.match(developSource, /startServer/u);
    // Vite is the launcher's own child, so stopping the launcher stops Vite (npm left it running).
    assert.match(developSource, /spawn\(\s*process\.execPath,\s*\[viteCli,/u);
    assert.doesNotMatch(developSource, /"run", "dev"/u);
  }
});

test("foundation browser configurations serve the production build, a server per worker, or use the managed server", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const load = (env) => loadPlaywrightConfig(patternName, {
      PLAYWRIGHT_BASE_URL: "", PLAYWRIGHT_PORT: "", PLAYWRIGHT_WORKERS: "", TEST_PARALLEL_INDEX: "", ...env
    });

    const managed = await load({ PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4321", V64_TEST_CONCURRENCY: "3" });
    assert.deepEqual(managed, { webServer: null, baseURL: "http://127.0.0.1:4321", workers: 1, globalTimeout: 80 * 60_000 });

    const local = await load({ V64_TEST_CONCURRENCY: "6" });
    assert.match(local.webServer.command, /^node "[^"]*\/browser-test-servers\.mjs"$/u);
    const settings = JSON.parse(local.webServer.env.JSKIT_BROWSER_TESTS);
    // A local run takes free ports of its own, so two runs on one machine never share a server.
    assert.ok(settings.basePort >= 20000 && settings.basePort < 32000, String(settings.basePort));
    assert.deepEqual(
      { workers: settings.workers, server: settings.server, build: settings.build },
      { workers: 3, server: "node ./bin/server.js", build: "npm run build" }
    );
    assert.equal(local.baseURL, `http://127.0.0.1:${settings.basePort}`);
    assert.equal(local.globalTimeout, 80 * 60_000 / 3);
    const packageJson = await readExamplePackageJson(patternName);
    assert.equal(packageJson.scripts?.build, "vite build");
    assert.equal(packageJson.scripts?.server, "node ./bin/server.js");

    // A Playwright worker loads the config with its own TEST_PARALLEL_INDEX and reaches its own server.
    const worker = await load({ PLAYWRIGHT_PORT: "4183", TEST_PARALLEL_INDEX: "2" });
    assert.equal(worker.baseURL, "http://127.0.0.1:4185");
    assert.equal(JSON.parse(worker.webServer.env.JSKIT_BROWSER_TESTS).basePort, 4183);
  }
});

test("application foundations run every test runner within the machine's test budget", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const exampleRoot = path.join(PATTERNS_ROOT, patternName, "example");
    const packageJson = await readExamplePackageJson(patternName);
    assert.equal(packageJson.scripts?.test, "jskit test");

    const { workers } = await loadPlaywrightConfig(patternName, {
      PLAYWRIGHT_BASE_URL: "", PLAYWRIGHT_WORKERS: "", V64_TEST_CONCURRENCY: "6"
    });
    // Half the budget: each browser worker drives a browser and its own app server.
    assert.equal(workers, 3);

    const viteConfigSource = await readFile(path.join(exampleRoot, "vite.config.mjs"), "utf8");
    assert.match(viteConfigSource, /^import \{ testConcurrency \} from "@jskit-ai\/jskit-catalog\/test-budget";$/mu);
    assert.match(viteConfigSource, /^ {4}maxWorkers: testConcurrency\(\)$/mu);
  }
});

test("application foundations keep linked packages on mutable Vite source paths", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const viteConfigSource = await readFile(
      path.join(PATTERNS_ROOT, patternName, "example", "vite.config.mjs"),
      "utf8"
    );

    assert.doesNotMatch(
      viteConfigSource,
      /preserveSymlinks/u,
      `${patternName} must retain Vite's default real-path resolution.`
    );
    assert.match(viteConfigSource, /createJskitClientBootstrapPlugin/u);
  }
});

test("application foundations limit warmup and prebundle auto-imported UI dependencies", async () => {
  for (const patternName of FOUNDATION_NAMES) {
    const source = await readFile(
      path.join(PATTERNS_ROOT, patternName, "example", "vite.config.mjs"),
      "utf8"
    );

    assert.match(source, /clientFiles:\s*\[clientEntry\.slice\(1\)\]/u,
      `${patternName} must not eagerly transform every page and component.`);
    assert.match(source, /["']vuetify\/components\/\*\*["']/u,
      `${patternName} must optimize components introduced after dependency scanning.`);
    assert.match(source, /["']vuetify\/directives\/\*\*["']/u,
      `${patternName} must optimize directives introduced after dependency scanning.`);
  }
});

test("application foundation guidance keeps service workers away from development modules", async () => {
  const guideSource = await readFile(
    path.join(PACKAGE_ROOT, "site", "guide", "app-setup", "initial-scaffolding.md"),
    "utf8"
  );

  assert.match(guideSource, /resolve\.preserveSymlinks: false/u);
  assert.match(guideSource, /content-hashed `\/assets\/` URLs/u);
  for (const developmentPath of [
    "/@fs/",
    "/@id/",
    "/@vite/",
    "/node_modules/",
    "/packages/",
    "/src/"
  ]) {
    assert.ok(
      guideSource.includes(`\`${developmentPath}\``),
      `Service-worker guidance is missing ${developmentPath}.`
    );
  }
});

test("shell foundation demonstrates skeleton loading and public adaptive-shell verification", async () => {
  const shellRoot = path.join(PATTERNS_ROOT, "shell-foundation", "example");
  const homeSource = await readFile(path.join(shellRoot, "src", "pages", "home", "index.vue"), "utf8");
  const adaptiveTestSource = await readFile(
    path.join(shellRoot, "tests", "e2e", "adaptive-shell.spec.ts"),
    "utf8"
  );

  assert.match(homeSource, /v-skeleton-loader/u);
  assert.doesNotMatch(homeSource, /loading\.\.\.|v-progress-circular/u);
  assert.match(adaptiveTestSource, /runAdaptiveShellSmokeCase/u);
  assert.doesNotMatch(adaptiveTestSource, /scrim|coordinates/u);
});

// The app's name is spelt where a person sees it: index.html's <title> and, once the app adds sign-in, the
// auth-surface pattern's AppBrand.vue. Both foundations name the same app, and their rename step names both places.
test("the foundations' app name is the sign-in brand's, and renaming the app renames both", async () => {
  const brand = await readFile(path.join(REPOSITORY_ROOT, "packages/auth-web/patterns/auth-surface/example/src/components/AppBrand.vue"), "utf8");
  const brandName = /const APP_NAME = "([^"]+)";/u.exec(brand)?.[1];
  assert.ok(brandName, "AppBrand.vue names the app");
  for (const patternName of FOUNDATION_NAMES) {
    const html = await readFile(path.join(PATTERNS_ROOT, patternName, "example", "index.html"), "utf8");
    assert.equal(/<title>([^<]+)<\/title>/u.exec(html)?.[1], brandName, `${patternName}'s <title> is the sign-in brand's name`);
    const pattern = await readFile(path.join(PATTERNS_ROOT, patternName, "PATTERN.md"), "utf8");
    assert.match(pattern, /`index\.html`'s `<title>`[\s\S]*`src\/components\/AppBrand\.vue`[\s\S]*rename them\s+together/u, `${patternName}'s rename step names both`);
  }
});

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/";

// Every new application copies its foundation's AGENTS.md, and projects kept copying it whole into their own
// instructions. It holds what an app needs that JSKIT's guides and checks do not already say: when to read which guide,
// what `npm run verify` runs, and how the browser suite runs on a host. Every other rule lives in its guide.
test("foundation agent instructions are short: the guide links, what verify runs and the managed browser rule", async () => {
  const [minimalAgents, shellAgents] = await Promise.all(FOUNDATION_NAMES.map((patternName) =>
    readFile(path.join(PATTERNS_ROOT, patternName, "example", "AGENTS.md"), "utf8")
  ));

  assert.equal(shellAgents, minimalAgents);
  const flat = minimalAgents.replace(/\s+/gu, " ");
  assert.match(minimalAgents, /https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\//u);
  assert.match(minimalAgents, /https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/patterns\//u);
  for (const page of [
    "framework/data-access",
    "framework/typed-features",
    "framework/client-features",
    "framework/environments",
    "framework/material-3",
    "framework/typed-features#test-files-run-in-parallel",
    "framework/ui-operations#browser-verification"
  ]) {
    assert.ok(minimalAgents.includes(`\`${GUIDE}${page}\``), `AGENTS.md links ${page}`);
  }
  // The guide is the website's, for the current release: agent-docs is not an app dependency, so there is no installed
  // copy of it to read, and an installed runtime package's own patterns/ folder holds its patterns at the app's version.
  assert.match(flat, /`@jskit-ai\/agent-docs` is not an app dependency, so the guide has no copy under `node_modules`/u);
  assert.match(flat, /Keep the app on the current release \(`npm run jskit:update`\)/u);
  assert.match(flat, /that package's `patterns\/` folder, at the app's version/u);
  assert.match(flat, /Never install a runtime package only to read its documentation/u);
  assert.doesNotMatch(minimalAgents, /node_modules\/@jskit-ai\/agent-docs|version-matched package-owned copy/u);
  // What `npm run verify` runs is exactly the foundation's verify script, in its order, and no section it lacks.
  const { scripts } = JSON.parse(await readFile(path.join(PATTERNS_ROOT, "minimal-foundation", "example", "package.json"), "utf8"));
  const verified = scripts.verify.split("&&").map((command) => command.trim());
  assert.deepEqual(verified, ["npm run jskit:check", "npm run lint", "npm run test", "npm run test:client", "npm run test:e2e"]);
  const verifySentence = flat.slice(flat.indexOf("`npm run verify` runs"), flat.indexOf("frontend it serves"));
  const named = ["`jskit check`", "`npm run lint`", "`npm test`", "`npm run test:client`", "`npm run test:e2e`"];
  assert.deepEqual(named.map((name) => verifySentence.indexOf(name) >= 0), named.map(() => true), verifySentence);
  assert.deepEqual([...named].sort((left, right) => verifySentence.indexOf(left) - verifySentence.indexOf(right)), named);
  assert.doesNotMatch(flat, /tests and build|adds the package graph/u);
  assert.match(flat, /`npm run test:e2e`, whose `browserTestConfig\(\)` builds the production frontend it serves/u);
  assert.match(flat, /excuse one only with the guide's `readable-check: allow` comment and reason prefix/u);
  // Rules a check enforces or a guide states are links, not copies.
  assert.doesNotMatch(minimalAgents, /SelectField|BROWSER_TEST_DB_NAME|jskit-test: alone|Keep verification output small|generator\s+provenance/u);
  assert.doesNotMatch(minimalAgents, /local app scaffold|crud-scaffolding\.md|workflow\/app-state\.md/u);
  assert.doesNotMatch(minimalAgents, /workflow\/feature-delivery\.md|Mandatory Start Gate|Mandatory Done Gate/u);
  // 6,105 characters in 103 lines until it kept only what no guide or check says.
  assert.ok(minimalAgents.length <= 3500, `AGENTS.md has ${minimalAgents.length} characters`);
});

test("the rules the foundation AGENTS.md no longer copies are each in their guide", async () => {
  const guide = (page) => readFile(path.join(PACKAGE_ROOT, "site/guide", page), "utf8");
  const flat = (source) => source.replace(/\s+/gu, " ");
  const [operations, material, client, uiOperations, typedFeatures] = await Promise.all([
    guide("framework/application-operations.md"),
    guide("framework/material-3.md"),
    guide("framework/client-features.md"),
    guide("framework/ui-operations.md"),
    guide("framework/typed-features.md")
  ]);
  assert.match(flat(operations), /Keep verification output small: save each run's complete output to a local file and keep its exit status/u);
  assert.match(flat(operations), /Do not add pattern receipts, generator provenance, completion ledgers, or hidden operation state/u);
  assert.match(flat(material), /standalone heading/u);
  assert.match(flat(client), /`SelectField`/u);
  assert.match(flat(uiOperations), /Keep `BROWSER_TEST_DB_NAME` distinct from `TEST_DB_NAME`/u);
  assert.match(flat(typedFeatures), /`\/\/ jskit-test: alone - <reason>`/u);
});

test("shell foundation reuses the shell-web application shell and the minimal foundation byte for byte", async () => {
  const shellRoot = path.join(PATTERNS_ROOT, "shell-foundation", "example");
  const minimalRoot = path.join(PATTERNS_ROOT, "minimal-foundation", "example");
  const applicationShellRoot = path.join(REPOSITORY_ROOT, "packages", "shell-web", "patterns", "application-shell", "example");
  const relativeFiles = async (root) => (await collectFiles(root)).map((filePath) => path.relative(root, filePath));
  const shellFiles = new Set(await relativeFiles(shellRoot));
  const readPair = (leftRoot, rightRoot, relativePath) => Promise.all([
    readFile(path.join(leftRoot, relativePath)),
    readFile(path.join(rightRoot, relativePath))
  ]);

  const applicationShellFiles = (await relativeFiles(applicationShellRoot))
    .filter((relativePath) => !relativePath.startsWith(`expected-existing${path.sep}`));
  assert.ok(applicationShellFiles.length > 10);
  for (const relativePath of applicationShellFiles) {
    assert.ok(shellFiles.has(relativePath), `shell-foundation is missing ${relativePath}.`);
    const [shellSource, applicationShellSource] = await readPair(shellRoot, applicationShellRoot, relativePath);
    assert.ok(shellSource.equals(applicationShellSource), `${relativePath} drifted from shell-web's application shell.`);
  }

  const expectedExistingRoot = path.join(applicationShellRoot, "expected-existing");
  for (const relativePath of await relativeFiles(expectedExistingRoot)) {
    const [minimalSource, expectedSource] = await readPair(minimalRoot, expectedExistingRoot, relativePath);
    assert.ok(minimalSource.equals(expectedSource), `expected-existing ${relativePath} drifted from minimal-foundation.`);
  }

  const foundationSpecificFiles = new Set([
    "package.json",
    path.join("packages", "main", "package.json"),
    path.join("tests", "e2e", "base-shell.spec.ts")
  ]);
  for (const relativePath of await relativeFiles(minimalRoot)) {
    if (foundationSpecificFiles.has(relativePath) || applicationShellFiles.includes(relativePath)) {
      continue;
    }
    assert.ok(shellFiles.has(relativePath), `shell-foundation is missing ${relativePath}.`);
    const [shellSource, minimalSource] = await readPair(shellRoot, minimalRoot, relativePath);
    assert.ok(shellSource.equals(minimalSource), `${relativePath} drifted from minimal-foundation.`);
  }
});

test("foundation lint configurations hold server code to typed features, client code to client features and all code to the size limits as errors", async () => {
  const probe = "export function createReader({ store } = {}) {\n  return () => store.read?.();\n}\n";
  const clientProbe = "let lastDraft = \"\";\nexport function useDraft({ store } = {}) {\n  return () => store.save?.(lastDraft);\n}\n";
  for (const patternName of FOUNDATION_NAMES) {
    const exampleRoot = path.join(PATTERNS_ROOT, patternName, "example");
    const { default: config } = await import(pathToFileURL(path.join(exampleRoot, "eslint.config.mjs")).href);
    const eslint = new ESLint({ cwd: exampleRoot, overrideConfigFile: true, overrideConfig: config });

    for (const relativePath of ["server.js", "server/lib/reader.js", "packages/booking/src/server/reader.js"]) {
      const [result] = await eslint.lintText(probe, { filePath: path.join(exampleRoot, relativePath) });
      const findings = result.messages.filter((message) => message.ruleId?.startsWith("jskit/"));
      assert.ok(findings.length > 0, `${patternName} does not check ${relativePath}.`);
      assert.ok(findings.every((message) => message.severity === 2), `${patternName} only warns on ${relativePath}.`);
    }

    for (const relativePath of ["src/composables/useDraft.js", "packages/main/src/client/useDraft.js"]) {
      const [result] = await eslint.lintText(clientProbe, { filePath: path.join(exampleRoot, relativePath) });
      const rules = new Set(result.messages.filter((message) => message.ruleId?.startsWith("jskit/")).map((message) => message.ruleId));
      assert.ok(rules.has("jskit/no-module-state") && rules.has("jskit/required-collaborators"), `${patternName} does not check ${relativePath}.`);
      assert.ok(result.messages.every((message) => message.severity === 2), `${patternName} only warns on ${relativePath}.`);
    }

    const longModule = Array.from({ length: 751 }, (_, index) => `export const value${index} = ${index};`).join("\n");
    for (const relativePath of ["src/components/LongTable.js", "packages/main/src/client/longTable.js", "bin/long.js"]) {
      const [result] = await eslint.lintText(`${longModule}\n`, { filePath: path.join(exampleRoot, relativePath) });
      assert.ok(result.messages.some((message) => message.ruleId === "max-lines" && message.severity === 2), `${patternName} lets ${relativePath} grow.`);
    }

    const results = await eslint.lintFiles(["server.js", "server/**/*.js", "bin/**/*.js", "config/**/*.js", "src/**/*.{js,vue}", "packages/**/*.js"]);
    const findings = results.flatMap((result) => result.messages.map((message) => (
      `${path.relative(exampleRoot, result.filePath)}:${message.line} ${message.ruleId || "parse"}`
    )));
    assert.deepEqual(findings, [], `${patternName} breaks its own lint configuration.`);
  }
});
