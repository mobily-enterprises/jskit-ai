import { synchronizeInstalledMigrations } from "../cliRuntime/migrationSync.js";

function parseIntentInvocation({ positional = [], options = {}, createCliError, commandName, intent }) {
  const [subcommand, ...extra] = positional.map((value) => String(value || "").trim());
  if (subcommand !== intent || extra.some(Boolean)) {
    throw createCliError(`${commandName} requires: ${commandName} ${intent} [--check]`, {
      showUsage: true
    });
  }
  const inlineOptions = options?.inlineOptions && typeof options.inlineOptions === "object"
    ? options.inlineOptions
    : {};
  const unknownOptions = Object.keys(inlineOptions).filter((name) => name !== "check");
  if (unknownOptions.length > 0) {
    throw createCliError(
      `Unknown option${unknownOptions.length === 1 ? "" : "s"} for jskit ${commandName} ${intent}: ${unknownOptions.map((name) => `--${name}`).join(", ")}.`,
      { showUsage: true }
    );
  }
  return String(inlineOptions.check || "").trim().toLowerCase() === "true";
}

function createSynchronizationCommands(ctx = {}) {
  const {
    createCliError,
    resolveAppRootFromCwd,
    synchronizeAppCiWorkflow
  } = ctx;

  async function commandMigrations({ positional, options, cwd, stdout }) {
    const check = parseIntentInvocation({
      positional,
      options,
      createCliError,
      commandName: "migrations",
      intent: "sync"
    });
    const appRoot = await resolveAppRootFromCwd(cwd);
    const result = await synchronizeInstalledMigrations(ctx, { appRoot, check });
    if (check && result.changedFiles.length > 0) {
      throw createCliError(
        `Migration files are out of date: ${result.changedFiles.join(", ")}. Run: npx jskit migrations sync`,
        { exitCode: 1 }
      );
    }

    stdout.write(
      `${check ? "Checked" : "Synchronized"} migrations from ${result.migrationPackageIds.length} of ${result.packageCount} installed package(s).\n`
    );
    stdout.write(`Changed files: ${result.changedFiles.length}\n`);
    for (const filePath of result.changedFiles) {
      stdout.write(`- ${filePath}\n`);
    }
    if (check) {
      stdout.write("Migration files: current\n");
    } else {
      stdout.write("Database state was not changed. Run npm run db:migrate separately.\n");
    }
    return 0;
  }

  async function commandCi({ positional, options, cwd, stdout }) {
    const check = parseIntentInvocation({
      positional,
      options,
      createCliError,
      commandName: "ci",
      intent: "generate"
    });
    const appRoot = await resolveAppRootFromCwd(cwd);
    const result = await synchronizeAppCiWorkflow({ appRoot, dryRun: check });
    const changedFiles = [];
    if (result.workflowChanged) {
      changedFiles.push(result.path);
    }
    if (check && changedFiles.length > 0) {
      throw createCliError(
        `CI workflow is out of date: ${changedFiles.join(", ")}. Run: npx jskit ci generate`,
        { exitCode: 1 }
      );
    }

    stdout.write(`${check ? "Checked" : "Generated"} JSKIT CI workflow.\n`);
    stdout.write(`Changed files: ${changedFiles.length}\n`);
    for (const filePath of changedFiles) {
      stdout.write(`- ${filePath}\n`);
    }
    if (check) {
      stdout.write("CI workflow: current\n");
    }
    return 0;
  }

  return { commandCi, commandMigrations };
}

export { createSynchronizationCommands };
