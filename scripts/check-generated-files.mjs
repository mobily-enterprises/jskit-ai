import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeneratedReferencePaths } from "./check-generated-reference-paths.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_PATHS = Object.freeze([
  "packages/agent-docs/reference/autogen",
  "packages/agent-docs/guide/agent",
  "packages/agent-docs/skills/jskit/references/pattern-index.md",
  "packages/agent-docs/skills/jskit/references/existing-application-migration.md",
  "tooling/jskit-catalog/catalog/packages.json"
]);
const GENERATORS = Object.freeze([
  "tooling/jskit-catalog/scripts/build-catalog.mjs",
  "scripts/build-agent-docs.mjs"
]);

async function collectFiles(absolutePath, relativePath, files) {
  let entryStat;
  try {
    entryStat = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (entryStat.isFile()) {
    files.set(relativePath, await readFile(absolutePath));
    return;
  }
  if (!entryStat.isDirectory()) {
    return;
  }

  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    await collectFiles(
      path.join(absolutePath, entry.name),
      path.posix.join(relativePath.split(path.sep).join("/"), entry.name),
      files
    );
  }
}

async function snapshotGeneratedFiles(repoRoot = REPO_ROOT) {
  const files = new Map();
  for (const relativePath of GENERATED_PATHS) {
    await collectFiles(path.join(repoRoot, relativePath), relativePath, files);
  }
  return files;
}

function changedGeneratedPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((relativePath) => {
      const previous = before.get(relativePath);
      const current = after.get(relativePath);
      return !previous || !current || !previous.equals(current);
    })
    .sort();
}

function runGenerators(repoRoot = REPO_ROOT) {
  for (const scriptPath of GENERATORS) {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      stdio: "inherit"
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`${scriptPath} failed with exit code ${result.status}.`);
    }
  }
}

async function main() {
  const before = await snapshotGeneratedFiles();
  runGenerators();
  await validateGeneratedReferencePaths({ repoRoot: REPO_ROOT });
  const changedPaths = changedGeneratedPaths(before, await snapshotGeneratedFiles());

  if (changedPaths.length === 0) {
    process.stdout.write("Generated files are deterministic and current.\n");
    return;
  }

  process.stderr.write("Generated files changed during deterministic regeneration:\n");
  for (const relativePath of changedPaths) {
    process.stderr.write(`- ${relativePath}\n`);
  }
  process.stderr.write("Review and commit the refreshed generated outputs.\n");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  changedGeneratedPaths,
  snapshotGeneratedFiles
};
