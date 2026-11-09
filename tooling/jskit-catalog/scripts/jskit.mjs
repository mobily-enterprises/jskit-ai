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
import { checkDataAccess, formatDataAccessReport } from "./data-access.mjs";
import { checkMaterial3, formatMaterial3Report } from "./material3.mjs";
import { checkProject, updateProject } from "./project-packages.mjs";
import { runTests } from "./test-command.mjs";
import { checkTestRuns, formatTestRunsReport } from "./test-runs.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CATALOG_PATH = path.join(PACKAGE_ROOT, "catalog", "packages.json");
const I18N_SUBCOMMANDS = new Set(["export", "check"]);

function usage() {
  return [
    "Usage:",
    "  jskit update [--root <path>] [--no-install] [--manifest <path> ...]",
    "  jskit check [--root <path>] [--manifest <path> ...]",
    "  jskit check m3 [<path> ...] [--root <path>]",
    "  jskit i18n export <locale> [--root <path>]",
    "  jskit i18n check <locale> [--root <path>]",
    "  jskit test [node options] [files or globs]",
    "",
    "Commands:",
    "  update       Align root and workspace @jskit-ai/* declarations to this published catalog, then run npm install.",
    "  check        Fail when manifests or package-lock.json contain stale, mixed, or private singleton JSKIT stacks,",
    "               or when application source breaks a rule of the JSKIT Material 3 guide: a navigation rule (nav/*),",
    "               such as history or window.location navigation, a hand-built in-app path, a back control other than",
    "               the shell's Up arrow, an inner page without a declared parent or a main-navigation page that",
    "               declares one, a visual rule (m3/*), such as a raw colour, an MDI icon, an outlined card or a",
    "               fixed button height, or a rule for using components (ui/*), such as a prop a JSKIT component",
    "               no longer has. It also fails when",
    "               a package script runs tests outside the machine's test budget (test/*): node --test instead of",
    "               jskit test, a fixed test concurrency or worker count, or a Playwright or Vitest config whose",
    "               workers do not come from testConcurrency() of @jskit-ai/jskit-catalog/test-budget. A Playwright",
    "               config with a webServer uses browserTestConfig() of @jskit-ai/jskit-catalog/browser-tests (one",
    "               production-build server and database per worker), never a development server, and every one",
    "               has a globalTimeout. It fails when two table resources (defineTableResource) of the app and its",
    "               installed JSKIT packages share a table or a name (data/one-resource-per-table), or when a system",
    "               scope (a feature's systemScope, a systemContext() call) gives no literal reason (data/system-scope),",
    "               and it lists every system scope and every file the infrastructure exception lifts past the",
    "               data-access lint rules for review.",
    "  check m3     Check application UI source against the JSKIT Material 3 guide alone, with each finding's guide",
    "               section and every exception: the whole app, or only the given files and directories (a section,",
    "               or a task's changed files). Plain jskit check applies the same rules to the whole app.",
    "  i18n export  Write the English messages of the installed JSKIT packages to src/locales/<locale>/jskit.json",
    "               for translators, keeping existing translations and extra keys.",
    "  i18n check   Compare src/locales/<locale>/jskit.json with the installed packages' English; fail on missing keys,",
    "               invalid messages or placeholder mismatches, and list extra keys and untranslated messages.",
    "  test         Run node --test with these arguments, test files in parallel within the machine's test budget:",
    "               V64_TEST_CONCURRENCY when it is a positive whole number, otherwise half of the machine's CPUs",
    "               (at least 1). A file whose first line is `// jskit-test: alone - <reason>` runs after the others,",
    "               on its own. With --databases, each file running at once gets its own copy of TEST_DB_NAME,",
    "               restored from a schema snapshot (the app's knexfile.js and @jskit-ai/database-runtime); with no",
    "               usable TEST_DB_NAME, the files run one at a time on the connected database.",
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
  if (command === "test") {
    return { command, args };
  }
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
    if ((command === "i18n" || command === "check") && argument && !argument.startsWith("-")) {
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
  if (command === "check" && positionals.length > 0) {
    return parseMaterial3Args(options, positionals);
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

function parseMaterial3Args(options, positionals) {
  const [check, ...paths] = positionals;
  if (check !== "m3") {
    throw new Error(`Unknown argument: ${check}`);
  }
  if (options.additionalManifests) {
    throw new Error("--manifest is only valid with jskit update and jskit check.");
  }
  if (!options.install) {
    throw new Error("--no-install is only valid with jskit update.");
  }
  return {
    command: "check-m3",
    paths,
    projectRoot: options.projectRoot
  };
}

async function runMaterial3({ projectRoot, paths }) {
  const result = await checkMaterial3({ projectRoot, paths });
  const report = formatMaterial3Report(result);
  if (!result.ok) {
    throw new Error(report);
  }
  process.stdout.write(`${report}\n`);
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
  if (options.command === "check-m3") {
    await runMaterial3(options);
    return;
  }
  if (options.command === "test") {
    process.exitCode = await runTests(options.args);
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
    for (const { packageId, replacedBy } of result.retiredPackages) {
      process.stdout.write(`Removed ${packageId}, which this release retired: ${replacedBy} replaced it.\n`);
    }
    if (result.changedFiles.length < 1) {
      process.stdout.write(`JSKIT manifests already match catalog ${result.catalogVersion}.\n`);
    } else {
      process.stdout.write(
        `Aligned ${result.changedFiles.length} manifest(s) to JSKIT catalog ${result.catalogVersion}:\n` +
        `${result.changedFiles.map((file) => `- ${file}`).join("\n")}\n`
      );
    }
    if (result.addedMigrations.length > 0) {
      process.stdout.write(
        `The update installed ${result.addedMigrations.length} new package migration(s); run npm run db:migrate before ` +
        `the app serves requests, since the new packages read what they create:\n` +
        `${result.addedMigrations.map((entry) => `- ${entry}`).join("\n")}\n`
      );
    }
    if (!options.install) {
      process.stdout.write(
        "Skipped npm install; run it before jskit check. If it installs new package migrations, run npm run db:migrate " +
        "before the app serves requests.\n"
      );
    }
    return;
  }

  const result = await checkProject({
    projectRoot: options.projectRoot,
    additionalManifests: options.additionalManifests,
    checkInstalled: true,
    catalog
  });
  const ui = await checkMaterial3({ projectRoot: options.projectRoot });
  const tests = await checkTestRuns({ projectRoot: options.projectRoot, manifests: result.manifests });
  const data = await checkDataAccess({ projectRoot: options.projectRoot });
  // The data rules first: a graph that fails on many pin versions would otherwise bury them.
  const reports = [
    formatDataAccessReport(data),
    result.ok
      ? `JSKIT project graph is coordinated across ${result.manifests.length} manifest(s) and ` +
        `${result.installations.length} resolved package installation(s).`
      : `JSKIT project graph is inconsistent:\n- ${result.issues.join("\n- ")}`,
    formatMaterial3Report(ui),
    formatTestRunsReport(tests)
  ];
  if (!result.ok || !ui.ok || !tests.ok || !data.ok) {
    throw new Error(reports.join("\n"));
  }
  process.stdout.write(`${reports.join("\n")}\n`);
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
