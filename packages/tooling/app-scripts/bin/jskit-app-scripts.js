#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runProcessEnvGuardrail, createViolationReport } from "../src/guardrails/processEnv.js";
import { runApiContractsGuardrail } from "../src/guardrails/apiContracts.js";
import { runElementEjectCommand } from "../src/commands/elementEject.js";
import { runElementDiffCommand } from "../src/commands/elementDiff.js";

function shellQuote(value) {
  const raw = String(value ?? "");
  if (!raw) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

function printUsageAndExit(message) {
  if (message) {
    console.error(`Error: ${message}`);
    console.error("");
  }
  console.error("Usage: jskit-app-scripts <task> [-- <extra args>]");
  process.exit(1);
}

function createCliError(message, { showUsage = false, exitCode = 1 } = {}) {
  const error = new Error(String(message || "Task failed."));
  error.showUsage = Boolean(showUsage);
  error.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
  return error;
}

function parseTaskArguments(argv) {
  const [task, ...rest] = argv;
  if (!task) {
    printUsageAndExit("Missing task.");
  }

  const separatorIndex = rest.indexOf("--");
  const extraArgs = separatorIndex >= 0 ? rest.slice(separatorIndex + 1) : rest;
  return {
    task,
    extraArgs
  };
}

async function loadConfigFromCwd() {
  const appRoot = process.cwd();
  const candidates = ["app.scripts.config.mjs", "app.scripts.config.js"].map((filename) =>
    path.resolve(appRoot, filename)
  );

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      const module = await import(pathToFileURL(candidate).href);
      const config = module?.default;
      if (!config || typeof config !== "object") {
        throw new Error(`Config file ${path.basename(candidate)} must export a default object.`);
      }
      if (!config.tasks || typeof config.tasks !== "object") {
        throw new Error(`Config file ${path.basename(candidate)} must include a tasks object.`);
      }
      return {
        appRoot,
        config
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Missing app.scripts.config.mjs in current app directory.");
}

function resolveTaskDefinition(config, task) {
  const taskDefinition = config.tasks[task];
  if (taskDefinition) {
    return taskDefinition;
  }

  const supportedTasks = Object.keys(config.tasks).sort();
  throw new Error(`Unknown task "${task}". Available tasks: ${supportedTasks.join(", ")}`);
}

function createProcessOptions(env = {}, cwd = process.cwd()) {
  return {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit"
  };
}

function runShell(command, extraArgs, options) {
  const commandWithArgs =
    extraArgs.length > 0 ? `${command} ${extraArgs.map((arg) => shellQuote(arg)).join(" ")}` : command;
  return spawn(commandWithArgs, {
    ...options,
    shell: true
  });
}

function runCommand(taskDefinition, extraArgs, options) {
  const command = String(taskDefinition.command || "").trim();
  if (!command) {
    throw new Error("Task command must be a non-empty string.");
  }
  const args = Array.isArray(taskDefinition.args) ? taskDefinition.args.map((entry) => String(entry)) : [];
  return spawn(command, [...args, ...extraArgs], options);
}

function resolveGuardrailsConfig(config) {
  return config?.guardrails && typeof config.guardrails === "object" ? config.guardrails : {};
}

async function runBuiltinTask({ builtinTaskId, task, extraArgs, appRoot, config }) {
  const builtinAllowsExtraArgs = builtinTaskId === "elements:eject" || builtinTaskId === "elements:diff";
  if (!builtinAllowsExtraArgs && extraArgs.length > 0) {
    throw createCliError(`Task "${task}" does not accept extra arguments.`, {
      showUsage: false
    });
  }

  const guardrailsConfig = resolveGuardrailsConfig(config);

  if (builtinTaskId === "guardrails:process-env") {
    const processEnvConfig =
      guardrailsConfig.processEnv && typeof guardrailsConfig.processEnv === "object" ? guardrailsConfig.processEnv : {};
    const result = await runProcessEnvGuardrail({
      rootDir: appRoot,
      ...processEnvConfig
    });

    if (!result.ok) {
      throw createCliError(
        createViolationReport({
          allowedFiles: result.allowedFiles,
          violations: result.violations
        }),
        { showUsage: false }
      );
    }

    process.stdout.write("OK: no disallowed process.env usage found.\n");
    return;
  }

  if (builtinTaskId === "guardrails:api-contracts:sync" || builtinTaskId === "guardrails:api-contracts:check") {
    const apiContractsConfig =
      guardrailsConfig.apiContracts && typeof guardrailsConfig.apiContracts === "object"
        ? guardrailsConfig.apiContracts
        : {};
    const result = await runApiContractsGuardrail({
      appRoot,
      config: apiContractsConfig,
      checkOnly: builtinTaskId === "guardrails:api-contracts:check"
    });

    if (!result.ok) {
      throw createCliError(result.errorMessage || "README API contracts are out of sync.", {
        showUsage: false
      });
    }

    return;
  }

  if (builtinTaskId === "elements:eject") {
    const result = await runElementEjectCommand({
      appRoot,
      args: extraArgs
    });
    process.stdout.write(
      `Ejected ${result.sourceSpecifier} to ${path.relative(appRoot, result.targetPath)} (${result.packageName}@${result.packageVersion}).\\n`
    );
    return;
  }

  if (builtinTaskId === "elements:diff") {
    const result = await runElementDiffCommand({
      appRoot,
      args: extraArgs
    });
    if (!result.drift) {
      process.stdout.write(
        `No drift: ${result.sourceSpecifier} matches ${path.relative(appRoot, result.targetPath)}.\\n`
      );
      return;
    }

    process.stdout.write(
      `Drift detected: ${result.sourceSpecifier} vs ${path.relative(appRoot, result.targetPath)}\\n`
    );
    if (result.preview.length > 0) {
      process.stdout.write(`${result.preview.join("\\n")}\\n`);
    }

    if (result.check) {
      throw createCliError("Element drift detected.", {
        showUsage: false,
        exitCode: 1
      });
    }

    return;
  }

  throw createCliError(`Unknown builtin task "${builtinTaskId}".`, {
    showUsage: true
  });
}

function isBuiltinTaskDefinition(taskDefinition) {
  return (
    Boolean(taskDefinition) &&
    typeof taskDefinition === "object" &&
    !Array.isArray(taskDefinition) &&
    typeof taskDefinition.builtin === "string" &&
    String(taskDefinition.builtin || "").trim().length > 0
  );
}

async function main() {
  const { task, extraArgs } = parseTaskArguments(process.argv.slice(2));
  const { appRoot, config } = await loadConfigFromCwd();
  const taskDefinition = resolveTaskDefinition(config, task);

  if (isBuiltinTaskDefinition(taskDefinition)) {
    await runBuiltinTask({
      builtinTaskId: String(taskDefinition.builtin || "").trim(),
      task,
      extraArgs,
      appRoot,
      config
    });
    return;
  }

  let child;
  if (typeof taskDefinition === "string") {
    child = runShell(taskDefinition, extraArgs, createProcessOptions({}, appRoot));
  } else if (taskDefinition && typeof taskDefinition === "object") {
    const env = taskDefinition.env && typeof taskDefinition.env === "object" ? taskDefinition.env : {};
    if (taskDefinition.shell === true) {
      const shellCommand = String(taskDefinition.command || "").trim();
      child = runShell(shellCommand, extraArgs, createProcessOptions(env, appRoot));
    } else {
      child = runCommand(taskDefinition, extraArgs, createProcessOptions(env, appRoot));
    }
  } else {
    throw new Error(`Invalid task definition for "${task}".`);
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(String(error?.stack || error?.message || error));
    process.exit(1);
  });
}

main().catch((error) => {
  if (error?.showUsage === false) {
    console.error(String(error?.message || error));
    process.exit(Number(error?.exitCode || 1));
    return;
  }

  printUsageAndExit(String(error?.message || error));
});
