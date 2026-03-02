import { access, lstat, mkdir, readFile, readlink, rm, symlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const LOCAL_SPEC_PREFIX = "file:node_modules/@jskit-ai/jskit/";
const JSKIT_SCOPE = "@jskit-ai";
const JSKIT_PACKAGE_NAME = "@jskit-ai/jskit";

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureSymlink(linkPath, targetRelativePath) {
  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const existingTarget = await readlink(linkPath);
      if (existingTarget === targetRelativePath) {
        return false;
      }
    }
    await rm(linkPath, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await symlink(targetRelativePath, linkPath);
  return true;
}

async function resolveJskitRepoRoot(appRoot, namespaceDir, jskitLinkPath) {
  try {
    const stats = await lstat(jskitLinkPath);
    if (stats.isSymbolicLink()) {
      const linkTarget = await readlink(jskitLinkPath);
      const resolvedTarget = path.resolve(namespaceDir, linkTarget);
      if (await pathExists(path.join(resolvedTarget, "tooling", "jskit", "bin", "jskit.js"))) {
        return resolvedTarget;
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const candidates = [];
  if (process.env.JSKIT_REPO_ROOT) {
    candidates.push(path.resolve(appRoot, process.env.JSKIT_REPO_ROOT));
  }
  candidates.push(path.resolve(appRoot, "../jskit-ai"));
  candidates.push(path.resolve(appRoot, "../../jskit-ai"));
  candidates.push(path.resolve(appRoot, "../../../jskit-ai"));

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "tooling", "jskit", "bin", "jskit.js"))) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate local jskit-ai repository. Set JSKIT_REPO_ROOT to your local repo root before npm install."
  );
}

async function main() {
  const appRoot = process.cwd();
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const namespaceDir = path.join(appRoot, "node_modules", JSKIT_SCOPE);
  const jskitLinkPath = path.join(namespaceDir, "jskit");

  await mkdir(namespaceDir, { recursive: true });

  const jskitRepoRoot = await resolveJskitRepoRoot(appRoot, namespaceDir, jskitLinkPath);
  const jskitTarget = toPosixPath(path.relative(namespaceDir, jskitRepoRoot));
  const changedLinks = [];

  if (await ensureSymlink(jskitLinkPath, jskitTarget)) {
    changedLinks.push(`${JSKIT_PACKAGE_NAME} -> ${jskitTarget}`);
  }

  const allDependencies = {
    ...Object(packageJson.dependencies),
    ...Object(packageJson.devDependencies),
    ...Object(packageJson.optionalDependencies)
  };

  for (const [dependencyId, dependencySpec] of Object.entries(allDependencies)) {
    if (!dependencyId.startsWith(`${JSKIT_SCOPE}/`) || dependencyId === JSKIT_PACKAGE_NAME) {
      continue;
    }
    if (typeof dependencySpec !== "string" || !dependencySpec.startsWith(LOCAL_SPEC_PREFIX)) {
      continue;
    }

    const packageLeafName = dependencyId.split("/")[1];
    const dependencyRelativeTarget = dependencySpec.slice(LOCAL_SPEC_PREFIX.length).replace(/^\/+/, "");
    const linkPath = path.join(namespaceDir, packageLeafName);
    const linkTarget = toPosixPath(path.join("jskit", dependencyRelativeTarget));
    if (await ensureSymlink(linkPath, linkTarget)) {
      changedLinks.push(`${dependencyId} -> ${linkTarget}`);
    }
  }

  if (changedLinks.length > 0) {
    for (const line of changedLinks) {
      console.log(`[jskit-links] ${line}`);
    }
  } else {
    console.log("[jskit-links] symlinks already up to date.");
  }
}

main().catch((error) => {
  console.error(`[jskit-links] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
