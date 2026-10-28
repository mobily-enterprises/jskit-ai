#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  canonicalLocale,
  checkTranslations,
  exportTranslations,
  formatCheckReport,
  formatExportSummary
} from "./i18n.mjs";
import { checkProject, updateProject } from "./project-packages.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CATALOG_PATH = path.join(PACKAGE_ROOT, "catalog", "packages.json");
const I18N_SUBCOMMANDS = new Set(["export", "check"]);

function usage() {
  return [
    "Usage:",
    "  jskit update [--root <path>] [--no-install] [--manifest <path> ...]",
    "  jskit check [--root <path>] [--manifest <path> ...]",
    "  jskit i18n export <locale> [--root <path>]",
    "  jskit i18n check <locale> [--root <path>]",
    "",
    "Commands:",
    "  update       Align root and workspace @jskit-ai/* declarations to this published catalog, then run npm install.",
    "  check        Fail when manifests or package-lock.json contain stale, mixed, or private singleton JSKIT stacks.",
    "  i18n export  Write the English messages of the installed JSKIT packages to src/locales/<locale>/jskit.json",
    "               for translators, keeping existing translations and extra keys.",
    "  i18n check   Compare src/locales/<locale>/jskit.json with the installed packages' English; fail on missing keys,",
    "               invalid messages or placeholder mismatches, and list extra keys and untranslated messages.",
    "",
    "<locale> is a BCP 47 language tag, such as fr or pt-BR."
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
  const positionals = [];

  while (args.length > 0) {
    const argument = String(args.shift() || "").trim();
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (command === "i18n" && argument && !argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--no-install") {
      options.install = false;
      continue;
    }
    if (argument === "--manifest") {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error("--manifest requires a package.json path.");
      (options.additionalManifests ||= []).push(value);
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
  if (command === "i18n") {
    return parseI18nArgs(options, positionals);
  }
  if (command !== "update" && command !== "check") {
    throw new Error(usage());
  }
  if (command === "check" && options.install === false) {
    throw new Error("--no-install is only valid with jskit update.");
  }
  return options;
}

function parseI18nArgs(options, positionals) {
  const [subcommandArgument = "", locale, unexpected] = positionals;
  const subcommand = subcommandArgument.toLowerCase();
  if (!I18N_SUBCOMMANDS.has(subcommand)) {
    throw new Error(usage());
  }
  if (unexpected !== undefined) {
    throw new Error(`Unknown argument: ${unexpected}`);
  }
  if (!options.install) {
    throw new Error("--no-install is only valid with jskit update.");
  }
  if (options.additionalManifests) {
    throw new Error("--manifest is only valid with jskit update and jskit check.");
  }
  if (!locale) {
    throw new Error(`jskit i18n ${subcommand} needs a locale, such as fr or pt-BR.`);
  }
  return {
    command: "i18n",
    subcommand,
    locale: canonicalLocale(locale),
    projectRoot: options.projectRoot
  };
}

async function runI18n({ subcommand, locale, projectRoot }) {
  if (subcommand === "export") {
    const result = await exportTranslations({ projectRoot, locale });
    process.stdout.write(`${formatExportSummary(result, projectRoot)}\n`);
    return;
  }
  const result = await checkTranslations({ projectRoot, locale });
  const report = formatCheckReport(result, projectRoot);
  if (!result.ok) {
    throw new Error(report);
  }
  process.stdout.write(`${report}\n`);
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
  if (options.command === "i18n") {
    await runI18n(options);
    return;
  }

  const catalog = await readCatalog();
  if (options.command === "update") {
    const result = await updateProject({
      projectRoot: options.projectRoot,
      catalog,
      additionalManifests: options.additionalManifests,
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
    additionalManifests: options.additionalManifests,
    checkInstalled: true,
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
