import path from "node:path";
import { lstat, mkdir, readFile, readlink, rm, symlink } from "node:fs/promises";
import {
  discoverLocalPackageMap,
  fileExists,
  linkPackageBinEntries,
  resolveLocalRepoRoot,
  resolveSymlinkType
} from "./shared.js";

const COMPANION_PACKAGES = Object.freeze([
  Object.freeze({
    packageName: "json-rest-schema",
    repoDirName: "json-rest-schema"
  }),
  Object.freeze({
    packageName: "json-rest-stores",
    repoDirName: "json-rest-stores"
  })
]);

function collectDeclaredPackageNames(packageJson = {}) {
  const names = new Set();
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.optionalDependencies,
    packageJson?.peerDependencies
  ];

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const packageName of Object.keys(section)) {
      const normalizedPackageName = String(packageName || "").trim();
      if (normalizedPackageName) {
        names.add(normalizedPackageName);
      }
    }
  }

  return names;
}

async function verifySymlinkTarget(targetPath = "", sourceDir = "", {
  packageName = ""
} = {}) {
  const stats = await lstat(targetPath);
  if (!stats.isSymbolicLink()) {
    throw new Error(`[link-local] expected ${packageName || targetPath} to be a symlink after linking.`);
  }

  const linkedTarget = await readlink(targetPath);
  if (linkedTarget !== sourceDir) {
    throw new Error(
      `[link-local] expected ${packageName || targetPath} to link to ${sourceDir}, got ${linkedTarget}.`
    );
  }
}

async function maybeLinkCompanionPackages({
  appRoot = "",
  repoRoot = "",
  stdout,
  createCliError
}) {
  const companionRoot = path.dirname(repoRoot);
  const appPackageJsonPath = path.join(appRoot, "package.json");
  let appPackageJson = {};
  try {
    appPackageJson = JSON.parse(await readFile(appPackageJsonPath, "utf8"));
  } catch {
    appPackageJson = {};
  }
  const declaredPackageNames = collectDeclaredPackageNames(appPackageJson);
  let linkedCount = 0;

  for (const companion of COMPANION_PACKAGES) {
    if (!declaredPackageNames.has(companion.packageName)) {
      continue;
    }

    const sourceDir = path.join(companionRoot, companion.repoDirName);
    const packageJsonPath = path.join(sourceDir, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      throw createCliError(
        `[link-local] companion package ${companion.packageName} is declared by the app but local source was not found at ${sourceDir}.`,
        { exitCode: 1 }
      );
    }

    let packageJson = {};
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    } catch {
      continue;
    }

    if (String(packageJson?.name || "").trim() !== companion.packageName) {
      throw createCliError(
        `[link-local] companion source at ${sourceDir} does not match expected package ${companion.packageName}.`,
        { exitCode: 1 }
      );
    }

    const targetPath = path.join(appRoot, "node_modules", companion.packageName);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await rm(targetPath, { recursive: true, force: true });
    await symlink(sourceDir, targetPath, resolveSymlinkType());
    await verifySymlinkTarget(targetPath, sourceDir, {
      packageName: companion.packageName
    });
    stdout.write(`[link-local] linked ${companion.packageName} -> ${sourceDir}\n`);
    linkedCount += 1;
  }

  return linkedCount;
}

async function runAppLinkLocalPackagesCommand(ctx = {}, { appRoot = "", options = {}, stdout }) {
  const { createCliError } = ctx;
  const explicitRepoRoot = String(options?.inlineOptions?.["repo-root"] || "").trim();
  const scopeDirectory = path.join(appRoot, "node_modules", "@jskit-ai");
  const viteCacheDirectory = path.join(appRoot, "node_modules", ".vite");

  if (!(await fileExists(scopeDirectory))) {
    throw createCliError(`[link-local] @jskit-ai scope not found at ${scopeDirectory} (run npm install first).`, {
      exitCode: 1
    });
  }

  const repoRoot = await resolveLocalRepoRoot({ appRoot, explicitRepoRoot });
  if (!repoRoot) {
    throw createCliError("[link-local] no JSKIT repository found. Set JSKIT_REPO_ROOT or use --repo-root.", {
      exitCode: 1
    });
  }

  if (!(await fileExists(path.join(repoRoot, "packages"))) || !(await fileExists(path.join(repoRoot, "tooling")))) {
    throw createCliError(`[link-local] JSKIT repo root is not valid: ${repoRoot}`, {
      exitCode: 1
    });
  }

  const packageMap = await discoverLocalPackageMap(repoRoot);
  let linkedCount = 0;
  await mkdir(scopeDirectory, { recursive: true });

  for (const [packageDirName, sourceDir] of [...packageMap.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const targetPath = path.join(scopeDirectory, packageDirName);
    await rm(targetPath, { recursive: true, force: true });
    await symlink(sourceDir, targetPath, resolveSymlinkType());
    stdout.write(`[link-local] linked @jskit-ai/${packageDirName} -> ${sourceDir}\n`);
    await linkPackageBinEntries({
      appRoot,
      packageDirName,
      sourceDir,
      stdout
    });
    linkedCount += 1;
  }

  linkedCount += await maybeLinkCompanionPackages({
    appRoot,
    repoRoot,
    stdout,
    createCliError
  });

  if (await fileExists(viteCacheDirectory)) {
    await rm(viteCacheDirectory, { recursive: true, force: true });
    stdout.write(`[link-local] cleared Vite cache at ${viteCacheDirectory}\n`);
  }

  stdout.write(`[link-local] done. linked=${linkedCount}\n`);
  return 0;
}

export { runAppLinkLocalPackagesCommand };
