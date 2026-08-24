#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkProject, updateProject } from "./project-packages.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CATALOG_PATH = path.join(PACKAGE_ROOT, "catalog", "packages.json");

function usage() {
  return [
    "Usage:",
    "  jskit update [--root <path>] [--no-install]",
    "  jskit check [--root <path>]",
    "",
    "Commands:",
    "  update  Align root and workspace @jskit-ai/* declarations to this published catalog, then run npm install.",
    "  check   Fail when manifests or package-lock.json contain stale, mixed, or private singleton JSKIT stacks."
  ].join("\n");
}

function parseArgs(argv = []) {
  const args = [...argv];
  const commandArgument = String(args.shift() || "").trim().toLowerCase();
  const command = commandArgument === "--help" || commandArgument === "-h"
    ? "help"
    : commandArgument;
  const options = {
    command,
    projectRoot: process.cwd(),
    install: true
  };

  while (args.length > 0) {
    const argument = String(args.shift() || "").trim();
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--no-install") {
      options.install = false;
      continue;
    }
    if (argument === "--root") {
      const value = String(args.shift() || "").trim();
      if (!value) {
        throw new Error("--root requires a path.");
      }
      options.projectRoot = path.resolve(value);
      continue;
    }
    if (argument.startsWith("--root=")) {
      options.projectRoot = path.resolve(argument.slice("--root=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help || command === "help") {
    return options;
  }
  if (command !== "update" && command !== "check") {
    throw new Error(usage());
  }
  if (command === "check" && options.install === false) {
    throw new Error("--no-install is only valid with jskit update.");
  }
  return options;
}

async function readCatalog() {
  return JSON.parse(await readFile(CATALOG_PATH, "utf8"));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || options.command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const catalog = await readCatalog();
  if (options.command === "update") {
    const result = await updateProject({
      projectRoot: options.projectRoot,
      catalog,
      install: options.install
    });
    if (result.changedFiles.length < 1) {
      process.stdout.write(`JSKIT manifests already match catalog ${result.catalogVersion}.\n`);
    } else {
      process.stdout.write(
        `Aligned ${result.changedFiles.length} manifest(s) to JSKIT catalog ${result.catalogVersion}:\n` +
        `${result.changedFiles.map((file) => `- ${file}`).join("\n")}\n`
      );
    }
    if (!options.install) {
      process.stdout.write("Skipped npm install; run it before jskit check.\n");
    }
    return;
  }

  const result = await checkProject({
    projectRoot: options.projectRoot,
    catalog
  });
  if (!result.ok) {
    throw new Error(`JSKIT project graph is inconsistent:\n- ${result.issues.join("\n- ")}`);
  }
  process.stdout.write(
    `JSKIT project graph is coordinated across ${result.manifests.length} manifest(s) and ` +
    `${result.installations.length} resolved package installation(s).\n`
  );
}

function isCliEntrypoint(argvPath = process.argv[1]) {
  if (!argvPath) {
    return false;
  }
  try {
    return realpathSync(argvPath) === realpathSync(SCRIPT_PATH);
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { isCliEntrypoint, main, parseArgs, usage };
