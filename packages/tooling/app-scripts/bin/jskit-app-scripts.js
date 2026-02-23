#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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

async function main() {
  const { task, extraArgs } = parseTaskArguments(process.argv.slice(2));
  const { appRoot, config } = await loadConfigFromCwd();
  const taskDefinition = resolveTaskDefinition(config, task);

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
  printUsageAndExit(String(error?.message || error));
});
