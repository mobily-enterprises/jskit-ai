import { ensureObject } from "../../shared/collectionUtils.js";

async function runPackageUpdateCommand(
  ctx = {},
  { positional, options, cwd, io },
  { runCommandAdd }
) {
  const {
    createCliError,
    resolveAppRootFromCwd,
    loadLockFile,
    resolveInstalledPackageIdInput
  } = ctx;

  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetId) {
    throw createCliError("update requires: update package <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedPackages);
  if (!resolvedTargetId) {
    throw createCliError(
      `Package is not installed: ${targetId}. update package only reapplies packages already recorded in .jskit/lock.json. If you meant to install it, run: jskit add package ${targetId}`
    );
  }

  return runCommandAdd({
    positional: ["package", resolvedTargetId],
    options: {
      ...options,
      forceReapplyTarget: true
    },
    cwd,
    io
  });
}

export { runPackageUpdateCommand };
