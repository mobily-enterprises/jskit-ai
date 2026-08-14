import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CANDIDATE_PACKAGES_DIRECTORY = ".candidate-packages";
const CANDIDATE_WORKSPACE_PATTERN = `${CANDIDATE_PACKAGES_DIRECTORY}/*`;
const CURRENT_JSKIT_WORKSPACE_NPM_ENV = Object.freeze({
  "npm_config_@jskit-ai:registry": "http://127.0.0.1:9/",
  npm_config_fetch_retries: "0",
  npm_config_fetch_timeout: "1000"
});
const DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
]);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function collectCurrentJskitPackages() {
  const packages = new Map();

  for (const parentName of ["packages", "tooling"]) {
    const parentRoot = path.join(REPOSITORY_ROOT, parentName);
    const entries = await readdir(parentRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const packageRoot = path.join(parentRoot, entry.name);
      let packageJson;
      try {
        packageJson = await readJson(path.join(packageRoot, "package.json"));
      } catch {
        continue;
      }
      const packageId = String(packageJson.name || "").trim();
      const version = String(packageJson.version || "").trim();
      if (!packageId.startsWith("@jskit-ai/") || !version) {
        continue;
      }
      packages.set(packageId, Object.freeze({ packageRoot, version }));
    }
  }

  return new Map([...packages.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function stageCurrentJskitWorkspaces(appRoot) {
  const packages = await collectCurrentJskitPackages();
  const candidatesRoot = path.join(appRoot, CANDIDATE_PACKAGES_DIRECTORY);
  await mkdir(candidatesRoot, { recursive: true });

  for (const [packageId, candidate] of packages) {
    const packageName = packageId.slice(packageId.indexOf("/") + 1);
    await symlink(
      candidate.packageRoot,
      path.join(candidatesRoot, packageName),
      process.platform === "win32" ? "junction" : "dir"
    );
  }

  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJson(packageJsonPath);
  const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
  packageJson.workspaces = [...new Set([...workspaces, CANDIDATE_WORKSPACE_PATTERN])];
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  return packages;
}

async function restoreCurrentJskitDependencyVersions(appRoot, packages) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJson(packageJsonPath);

  for (const sectionName of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[sectionName];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    for (const packageId of Object.keys(dependencies)) {
      const candidate = packages.get(packageId);
      if (candidate) {
        dependencies[packageId] = candidate.version;
      }
    }
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export {
  CURRENT_JSKIT_WORKSPACE_NPM_ENV,
  restoreCurrentJskitDependencyVersions,
  stageCurrentJskitWorkspaces
};
