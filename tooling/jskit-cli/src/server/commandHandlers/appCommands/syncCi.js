async function runAppSyncCiCommand(ctx = {}, { appRoot = "", options = {}, stdout }) {
  const {
    createCliError,
    synchronizeAppCiWorkflow
  } = ctx;
  const force = String(options?.inlineOptions?.force || "").trim().toLowerCase() === "true";
  const result = await synchronizeAppCiWorkflow({
    appRoot,
    allowManagedOverwrite: force
  });
  if (!result.applicable) {
    throw createCliError("jskit app sync-ci only works in a JSKIT app root.");
  }

  if (options.json) {
    stdout.write(`${JSON.stringify({
      path: result.path,
      hash: result.hash,
      changed: result.changed,
      removedLegacyWorkflow: result.removedLegacyWorkflow,
      replacedModifiedWorkflow: result.replacedModifiedWorkflow
    }, null, 2)}\n`);
    return 0;
  }

  if (result.replacedModifiedWorkflow) {
    stdout.write(`Replaced the modified JSKIT-managed CI workflow: ${result.path}\n`);
  } else if (result.changed) {
    stdout.write(`Synchronized the JSKIT-managed CI workflow: ${result.path}\n`);
  } else {
    stdout.write(`The JSKIT-managed CI workflow is already current: ${result.path}\n`);
  }
  if (result.removedLegacyWorkflow) {
    stdout.write("Removed the superseded .github/workflows/verify.yml scaffold.\n");
  }
  stdout.write(`Recorded content hash: ${result.hash}\n`);
  return 0;
}

export { runAppSyncCiCommand };
