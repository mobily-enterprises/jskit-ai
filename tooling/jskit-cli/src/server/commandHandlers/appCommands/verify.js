import { runExternalCommand, runLocalJskit } from "./shared.js";

const BASELINE_VERIFY_SCRIPTS = Object.freeze([
  "lint",
  "test",
  "test:client",
  "build"
]);

async function runAppVerifyCommand(ctx = {}, { appRoot = "", options = {}, stdout, stderr }) {
  const { createCliError } = ctx;
  const inlineOptions =
    options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {};
  const against = String(inlineOptions.against || "").trim();

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

  const doctorArgs = ["doctor"];
  if (against) {
    doctorArgs.push("--against", against);
  }

  await runLocalJskit(appRoot, doctorArgs, {
    stdout,
    stderr,
    createCliError
  });

  return 0;
}

export { runAppVerifyCommand };
