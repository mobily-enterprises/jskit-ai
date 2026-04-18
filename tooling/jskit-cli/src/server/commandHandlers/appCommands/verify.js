import { runExternalCommand, runLocalJskit } from "./shared.js";

const BASELINE_VERIFY_SCRIPTS = Object.freeze([
  "lint",
  "test",
  "test:client",
  "build"
]);

async function runAppVerifyCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const { createCliError } = ctx;

  if (options?.dryRun) {
    throw createCliError("jskit app verify does not support --dry-run.", { exitCode: 1 });
  }

  for (const scriptName of BASELINE_VERIFY_SCRIPTS) {
    runExternalCommand("npm", ["run", "--if-present", scriptName], {
      cwd: appRoot,
      stdout,
      stderr,
      createCliError
    });
  }

  await runLocalJskit(appRoot, ["doctor"], {
    stdout,
    stderr,
    createCliError
  });

  return 0;
}

export { runAppVerifyCommand };
