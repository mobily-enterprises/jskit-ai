import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createCliError } from "./cliError.js";
import { shellQuote } from "./cliEntrypoint.js";

const DEFAULT_TEMPLATE = "base-shell";
const DEFAULT_INITIAL_BUNDLES = "none";
const INITIAL_BUNDLE_PRESETS = new Set(["none", "auth"]);
const TENANCY_MODES = new Set(["none", "personal", "workspaces"]);
const ALLOWED_EXISTING_TARGET_ENTRIES = new Set([".git"]);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES_ROOT = path.join(PACKAGE_ROOT, "templates");

function toAppTitle(appName) {
  const words = String(appName)
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);

  return words.length > 0 ? words.join(" ") : "App";
}

function normalizeInitialBundlesPreset(value, { showUsage = true } = {}) {
  const normalized = String(value || DEFAULT_INITIAL_BUNDLES).trim().toLowerCase();
  if (INITIAL_BUNDLE_PRESETS.has(normalized)) {
    return normalized;
  }

  throw createCliError(
    `Invalid --initial-bundles value "${value}". Expected one of: none, auth.`,
    { showUsage }
  );
}

function normalizeTenancyMode(value, { showUsage = true } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (TENANCY_MODES.has(normalized)) {
    return normalized;
  }

  throw createCliError(
    `Invalid --tenancy-mode value "${value}". Expected one of: none, personal, workspaces.`,
    { showUsage }
  );
}

function buildInitialSetupCommands(initialBundles) {
  const normalizedPreset = normalizeInitialBundlesPreset(initialBundles, { showUsage: false });

  const commands = [];
  if (normalizedPreset === "auth") {
    commands.push(
      "npx jskit add package auth-provider-supabase-core --auth-supabase-url \"https://YOUR-PROJECT.supabase.co\" --auth-supabase-publishable-key \"sb_publishable_...\" --app-public-url \"http://localhost:5173\""
    );
    commands.push("npx jskit add bundle auth-base");
  }

  return commands;
}

function validateAppName(appName, { showUsage = true } = {}) {
  if (!appName || typeof appName !== "string") {
    throw createCliError("Missing app name.", { showUsage });
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(appName)) {
    throw createCliError(
      `Invalid app name "${appName}". Use lowercase letters, numbers, and dashes only.`,
      { showUsage }
    );
  }
}

function parseOptionWithValue(argv, index, optionName) {
  const nextValue = argv[index + 1];
  if (!nextValue || nextValue.startsWith("-")) {
    throw createCliError(`Option ${optionName} requires a value.`, {
      showUsage: true
    });
  }
  return {
    value: nextValue,
    nextIndex: index + 1
  };
}

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const options = {
    appName: null,
    appTitle: null,
    template: DEFAULT_TEMPLATE,
    target: null,
    initialBundles: DEFAULT_INITIAL_BUNDLES,
    tenancyMode: null,
    force: false,
    dryRun: false,
    help: false,
    interactive: false
  };

  const positionalArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "");

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--interactive") {
      options.interactive = true;
      continue;
    }

    if (arg === "--template") {
      const { value, nextIndex } = parseOptionWithValue(args, index, "--template");
      options.template = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--template=")) {
      options.template = arg.slice("--template=".length);
      continue;
    }

    if (arg === "--target") {
      const { value, nextIndex } = parseOptionWithValue(args, index, "--target");
      options.target = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
      continue;
    }

    if (arg === "--title") {
      const { value, nextIndex } = parseOptionWithValue(args, index, "--title");
      options.appTitle = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--title=")) {
      options.appTitle = arg.slice("--title=".length);
      continue;
    }

    if (arg === "--initial-bundles") {
      const { value, nextIndex } = parseOptionWithValue(args, index, "--initial-bundles");
      options.initialBundles = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--initial-bundles=")) {
      options.initialBundles = arg.slice("--initial-bundles=".length);
      continue;
    }

    if (arg === "--tenancy-mode") {
      const { value, nextIndex } = parseOptionWithValue(args, index, "--tenancy-mode");
      options.tenancyMode = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--tenancy-mode=")) {
      options.tenancyMode = arg.slice("--tenancy-mode=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw createCliError(`Unknown option: ${arg}`, {
        showUsage: true
      });
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    throw createCliError("Only one <app-name> argument is allowed.", {
      showUsage: true
    });
  }

  if (positionalArgs.length === 1) {
    options.appName = positionalArgs[0];
  }

  if (!options.help && !options.interactive && positionalArgs.length !== 1) {
    throw createCliError("Expected exactly one <app-name> argument.", {
      showUsage: true
    });
  }

  return options;
}

function printUsage(stream = process.stderr) {
  stream.write("Usage: jskit-create-app [app-name] [options]\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write(`  --template <name>  Template folder under templates/ (default: ${DEFAULT_TEMPLATE})\n`);
  stream.write("  --title <text>     App title used for template replacements\n");
  stream.write("  --target <path>    Target directory (default: ./<app-name>)\n");
  stream.write("  --initial-bundles <preset>  Optional bundle preset: none | auth (default: none)\n");
  stream.write("  --tenancy-mode <mode>  Optional config seed: none | personal | workspaces\n");
  stream.write("  --force            Allow writing into a non-empty target directory\n");
  stream.write("  --dry-run          Print planned writes without changing the filesystem\n");
  stream.write("  --interactive      Prompt for app values instead of passing all flags\n");
  stream.write("  -h, --help         Show this help\n");
}

function applyPlaceholders(source, replacements) {
  let output = String(source || "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    output = output.split(placeholder).join(String(value));
  }
  return output;
}

function isPathWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizeTemplatePathSegments(templateName) {
  const rawTemplateName = String(templateName || "").trim();
  if (!rawTemplateName) {
    throw createCliError("Template name cannot be empty.", {
      showUsage: true
    });
  }

  const segments = rawTemplateName.split(/[\\/]+/).filter(Boolean);
  if (segments.length < 1 || segments.some((segment) => segment === "." || segment === "..")) {
    throw createCliError(`Invalid template "${rawTemplateName}".`);
  }

  return segments;
}

async function resolveTemplateDirectory(templateName) {
  const templatePathSegments = normalizeTemplatePathSegments(templateName);
  const cleanTemplate = templatePathSegments.join(path.sep);
  const templateDir = path.resolve(TEMPLATES_ROOT, ...templatePathSegments);

  if (!isPathWithinRoot(TEMPLATES_ROOT, templateDir)) {
    throw createCliError(`Invalid template "${cleanTemplate}".`);
  }

  try {
    const templateStats = await stat(templateDir);
    if (!templateStats.isDirectory()) {
      throw createCliError(`Template "${cleanTemplate}" is not a directory.`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createCliError(`Unknown template "${cleanTemplate}".`);
    }
    throw error;
  }

  return templateDir;
}

async function ensureTargetDirectoryState(targetDirectory, { force = false, dryRun = false } = {}) {
  let targetExists = false;

  try {
    const targetStats = await stat(targetDirectory);
    targetExists = true;
    if (!targetStats.isDirectory()) {
      throw createCliError(`Target path exists and is not a directory: ${targetDirectory}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!targetExists) {
    if (!dryRun) {
      await mkdir(targetDirectory, { recursive: true });
    }
    return;
  }

  const entries = await readdir(targetDirectory);
  const blockingEntries = entries.filter((entry) => !ALLOWED_EXISTING_TARGET_ENTRIES.has(entry));
  if (blockingEntries.length > 0 && !force) {
    throw createCliError(
      `Target directory is not empty: ${targetDirectory}. Use --force to allow writing into it.`
    );
  }
}

function sortEntriesByName(entries) {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

function mapTemplatePathToTargetPath(relativePath) {
  const pathSegments = String(relativePath || "")
    .split(path.sep)
    .map((segment) => (segment === "gitignore" ? ".gitignore" : segment));
  return pathSegments.join(path.sep);
}

async function writeTemplateFile(sourcePath, targetPath, replacements) {
  const sourceBody = await readFile(sourcePath, "utf8");
  const targetBody = applyPlaceholders(sourceBody, replacements);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, targetBody, "utf8");

  const sourceStats = await stat(sourcePath);
  await chmod(targetPath, sourceStats.mode & 0o777);
}

async function copyTemplateDirectory({ templateDirectory, targetDirectory, replacements, dryRun }) {
  const touchedFiles = [];

  async function traverse(relativePath = "") {
    const sourceDirectory = path.join(templateDirectory, relativePath);
    const sourceEntries = sortEntriesByName(await readdir(sourceDirectory, { withFileTypes: true }));

    for (const entry of sourceEntries) {
      const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const targetRelativePath = mapTemplatePathToTargetPath(entryRelativePath);
      const sourcePath = path.join(templateDirectory, entryRelativePath);
      const targetPath = path.join(targetDirectory, targetRelativePath);

      if (entry.isDirectory()) {
        if (!dryRun) {
          await mkdir(targetPath, { recursive: true });
        }
        await traverse(entryRelativePath);
        continue;
      }

      if (entry.isFile()) {
        touchedFiles.push(targetRelativePath);
        if (!dryRun) {
          await writeTemplateFile(sourcePath, targetPath, replacements);
        }
        continue;
      }

      throw createCliError(`Unsupported template entry type at ${entryRelativePath}.`);
    }
  }

  await traverse();
  return touchedFiles;
}

function toRelativeTargetLabel(cwd, targetDirectory) {
  const relativePath = path.relative(cwd, targetDirectory);
  if (!relativePath || relativePath === ".") {
    return ".";
  }
  if (relativePath.startsWith("..")) {
    return targetDirectory;
  }
  return `./${relativePath}`;
}

async function askQuestion(readline, label, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const response = await readline.question(`${label}${suffix}: `);
  const trimmed = response.trim();
  return trimmed || defaultValue;
}

async function askYesNoQuestion(readline, label, defaultValue) {
  const prompt = defaultValue ? "Y/n" : "y/N";

  while (true) {
    const response = await readline.question(`${label} [${prompt}]: `);
    const normalized = response.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }
    if (normalized === "y" || normalized === "yes") {
      return true;
    }
    if (normalized === "n" || normalized === "no") {
      return false;
    }
  }
}

function createReadlineInterface({ stdin = process.stdin, stdout = process.stdout } = {}) {
  return createInterface({
    input: stdin,
    output: stdout
  });
}

async function collectInteractiveOptions({
  parsed,
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = process.stdin,
  readlineFactory = createReadlineInterface
}) {
  const readline = readlineFactory({
    stdin,
    stdout
  });

  try {
    let appName = String(parsed.appName || "").trim();
    while (true) {
      appName = await askQuestion(readline, "App name", appName);
      try {
        validateAppName(appName, { showUsage: false });
        break;
      } catch (error) {
        stderr.write(`Error: ${error?.message || String(error)}\n`);
      }
    }

    const defaultTitle = String(parsed.appTitle || "").trim() || toAppTitle(appName);
    const appTitle = await askQuestion(readline, "App title", defaultTitle);

    const defaultTarget = String(parsed.target || "").trim() || appName;
    const target = await askQuestion(readline, "Target directory", defaultTarget);

    const defaultTemplate = String(parsed.template || "").trim() || DEFAULT_TEMPLATE;
    const template = await askQuestion(readline, "Template", defaultTemplate);

    const force = await askYesNoQuestion(
      readline,
      "Allow writing into non-empty target directories",
      Boolean(parsed.force)
    );

    let initialBundles = normalizeInitialBundlesPreset(parsed.initialBundles, { showUsage: false });
    while (true) {
      const candidate = await askQuestion(
        readline,
        "Initial bundle preset (none|auth)",
        initialBundles
      );
      try {
        initialBundles = normalizeInitialBundlesPreset(candidate, { showUsage: false });
        break;
      } catch (error) {
        stderr.write(`Error: ${error?.message || String(error)}\n`);
      }
    }

    let tenancyMode = String(parsed.tenancyMode || "").trim();
    if (tenancyMode) {
      tenancyMode = normalizeTenancyMode(tenancyMode, { showUsage: false });
    }
    while (true) {
      const candidate = await askQuestion(
        readline,
        "Tenancy mode (none|personal|workspaces, optional)",
        tenancyMode
      );
      if (!candidate) {
        tenancyMode = null;
        break;
      }
      try {
        tenancyMode = normalizeTenancyMode(candidate, { showUsage: false });
        break;
      } catch (error) {
        stderr.write(`Error: ${error?.message || String(error)}\n`);
      }
    }

    return {
      appName,
      appTitle,
      target,
      template,
      force,
      initialBundles,
      tenancyMode
    };
  } finally {
    readline.close();
  }
}

export async function createApp({
  appName,
  appTitle = null,
  template = DEFAULT_TEMPLATE,
  target = null,
  initialBundles = DEFAULT_INITIAL_BUNDLES,
  tenancyMode = null,
  force = false,
  dryRun = false,
  cwd = process.cwd()
}) {
  const resolvedAppName = String(appName || "").trim();
  validateAppName(resolvedAppName);

  const resolvedAppTitle = String(appTitle || "").trim() || toAppTitle(resolvedAppName);
  const resolvedInitialBundles = normalizeInitialBundlesPreset(initialBundles);
  const resolvedTenancyMode =
    tenancyMode == null || String(tenancyMode).trim() === ""
      ? null
      : normalizeTenancyMode(tenancyMode);

  const resolvedCwd = path.resolve(cwd);
  const targetDirectory = path.resolve(resolvedCwd, target ? String(target) : resolvedAppName);
  const templateDirectory = await resolveTemplateDirectory(template);

  await ensureTargetDirectoryState(targetDirectory, {
    force,
    dryRun
  });

  const replacements = {
    __APP_NAME__: resolvedAppName,
    __APP_TITLE__: resolvedAppTitle,
    __TENANCY_MODE_LINE__: resolvedTenancyMode
      ? `config.tenancyMode = "${resolvedTenancyMode}";\n`
      : ""
  };

  const touchedFiles = await copyTemplateDirectory({
    templateDirectory,
    targetDirectory,
    replacements,
    dryRun
  });

  return {
    appName: resolvedAppName,
    appTitle: resolvedAppTitle,
    template: String(template),
    initialBundles: resolvedInitialBundles,
    tenancyMode: resolvedTenancyMode,
    selectedSetupCommands: buildInitialSetupCommands(resolvedInitialBundles),
    targetDirectory,
    dryRun,
    touchedFiles
  };
}

export async function runCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    cwd = process.cwd(),
    readlineFactory = createReadlineInterface
  } = {}
) {
  try {
    const parsed = parseCliArgs(argv);

    if (parsed.help) {
      printUsage(stdout);
      return 0;
    }

    const resolvedOptions = parsed.interactive
      ? {
          ...parsed,
          ...(await collectInteractiveOptions({
            parsed,
            stdout,
            stderr,
            stdin,
            readlineFactory
          }))
        }
      : parsed;

    const result = await createApp({
      appName: resolvedOptions.appName,
      appTitle: resolvedOptions.appTitle,
      template: resolvedOptions.template,
      target: resolvedOptions.target,
      initialBundles: resolvedOptions.initialBundles,
      tenancyMode: resolvedOptions.tenancyMode,
      force: resolvedOptions.force,
      dryRun: resolvedOptions.dryRun,
      cwd
    });

    const targetLabel = toRelativeTargetLabel(path.resolve(cwd), result.targetDirectory);
    if (result.dryRun) {
      stdout.write(
        `[dry-run] Would create app "${result.appName}" from template "${result.template}" at ${targetLabel}.\n`
      );
    } else {
      stdout.write(`Created app "${result.appName}" from template "${result.template}" at ${targetLabel}.\n`);
    }
    stdout.write(`${result.dryRun ? "Planned" : "Written"} files (${result.touchedFiles.length}):\n`);
    for (const filePath of result.touchedFiles) {
      stdout.write(`- ${filePath}\n`);
    }

    if (!result.dryRun) {
      stdout.write("\n");
      stdout.write("Next steps:\n");
      stdout.write(`- cd ${shellQuote(targetLabel)}\n`);
      stdout.write("- npm install\n");
      stdout.write("- npm run dev\n");

      if (result.selectedSetupCommands.length > 0) {
        stdout.write("\n");
        stdout.write(`Initial framework setup commands (${result.initialBundles}):\n`);
        for (const command of result.selectedSetupCommands) {
          stdout.write(`- ${command}\n`);
        }
      }
    }

    return 0;
  } catch (error) {
    stderr.write(`Error: ${error?.message || String(error)}\n`);
    if (error?.showUsage) {
      stderr.write("\n");
      printUsage(stderr);
    }
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}
