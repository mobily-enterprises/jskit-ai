import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const PATTERNS_ROOT = path.join(PACKAGE_ROOT, "patterns");
const FOUNDATION_NAMES = Object.freeze(["minimal-foundation", "shell-foundation"]);

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

    assert.equal(packageJson.name, "reading-room");
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.dependencies?.["@jskit-ai/kernel"], kernelVersion);
    assert.equal(packageJson.dependencies?.["@jskit-ai/http-runtime"], httpRuntimeVersion);
    assert.equal(packageJson.devDependencies?.["@jskit-ai/jskit-catalog"], catalogVersion);
    assert.equal(packageJson.devDependencies?.["@jskit-ai/jskit-cli"], undefined);
    assert.equal(
      packageJson.scripts?.["jskit:update"],
      "npx --yes @jskit-ai/jskit-catalog@latest update"
    );
    assert.equal(packageJson.scripts?.["jskit:check"], "jskit check");
    assert.match(packageJson.scripts?.verify || "", /^npm run jskit:check && /u);
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

    assert.equal(files.some((filePath) => filePath.includes(`${path.sep}.vibe64${path.sep}`)), false);
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
