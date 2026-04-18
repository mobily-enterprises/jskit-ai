import path from "node:path";
import { mkdir, rm, symlink } from "node:fs/promises";
import {
  discoverLocalPackageMap,
  fileExists,
  linkPackageBinEntries,
  resolveLocalRepoRoot,
  resolveSymlinkType
} from "./shared.js";

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

  if (await fileExists(viteCacheDirectory)) {
    await rm(viteCacheDirectory, { recursive: true, force: true });
    stdout.write(`[link-local] cleared Vite cache at ${viteCacheDirectory}\n`);
  }

  stdout.write(`[link-local] done. linked=${linkedCount}\n`);
  return 0;
}

export { runAppLinkLocalPackagesCommand };
