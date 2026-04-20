import {
  createColorFormatter,
  writeWrappedLines
} from "../shared/outputFormatting.js";
import {
  APP_SCRIPT_WRAPPERS,
  buildAppCommandOptionMeta,
  listAppCommandDefinitions,
  resolveAppCommandDefinition
} from "./appCommandCatalog.js";
import { runAppAdoptManagedScriptsCommand } from "./appCommands/adoptManagedScripts.js";
import { runAppLinkLocalPackagesCommand } from "./appCommands/linkLocalPackages.js";
import { runAppReleaseCommand } from "./appCommands/release.js";
import { runAppUpdatePackagesCommand } from "./appCommands/updatePackages.js";
import { runAppVerifyCommand } from "./appCommands/verify.js";
import { runAppVerifyUiCommand } from "./appCommands/verifyUi.js";

function renderAppHelp(stream, definition = null) {
  const color = createColorFormatter(stream);
  const lines = [];

  if (!definition) {
    lines.push(`Command: ${color.emphasis("app")}`);
    lines.push("");
    lines.push(color.heading("1) Minimal use"));
    lines.push("   jskit app <subcommand>");
    lines.push("");
    lines.push(color.heading("2) Subcommands"));
    for (const entry of listAppCommandDefinitions()) {
      lines.push(`   - ${color.item(entry.name)}: ${entry.summary}`);
    }
    lines.push("");
    lines.push(color.heading("3) Notes"));
    lines.push("   - The scaffold keeps npm run shortcuts such as verify and jskit:update,");
    lines.push("     but the maintained behavior lives here in jskit app.");
    lines.push("   - Use jskit app <subcommand> help for subcommand-specific usage.");
    lines.push("");
    lines.push(color.heading("4) Scaffold wrappers"));
    for (const [scriptName, scriptCommand] of Object.entries(APP_SCRIPT_WRAPPERS)) {
      lines.push(`   - ${scriptName}: ${scriptCommand}`);
    }
    writeWrappedLines({
      stdout: stream,
      lines
    });
    return;
  }

  lines.push(`App subcommand: ${color.emphasis(definition.name)}`);
  lines.push("");
  lines.push(color.heading("1) Summary"));
  lines.push(`   ${definition.summary}`);
  lines.push("");
  lines.push(color.heading("2) Use"));
  lines.push(`   ${definition.usage}`);

  if (definition.options.length > 0) {
    lines.push("");
    lines.push(color.heading("3) Options"));
    for (const optionRow of definition.options) {
      lines.push(`   - ${optionRow.label}: ${optionRow.description}`);
    }
  }

  if (definition.defaults.length > 0) {
    lines.push("");
    lines.push(color.heading(definition.options.length > 0 ? "4) Defaults" : "3) Defaults"));
    for (const defaultLine of definition.defaults) {
      lines.push(`   - ${defaultLine}`);
    }
  }

  writeWrappedLines({
    stdout: stream,
    lines
  });
}

function createAppCommands(ctx = {}) {
  const {
    createCliError,
    resolveAppRootFromCwd
  } = ctx;

  async function commandApp({ positional = [], options = {}, cwd = "", stdout, stderr }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const firstToken = String(positional[0] || "").trim();
    const secondToken = String(positional[1] || "").trim();

    if (!firstToken) {
      renderAppHelp(stdout);
      return 0;
    }

    if (firstToken === "help") {
      renderAppHelp(stdout, resolveAppCommandDefinition(secondToken));
      return 0;
    }

    const definition = resolveAppCommandDefinition(firstToken);
    if (!definition) {
      throw createCliError(`Unknown app subcommand: ${firstToken}.`, {
        renderUsage: () => renderAppHelp(stderr)
      });
    }

    if (secondToken === "help") {
      renderAppHelp(stdout, definition);
      return 0;
    }

    const optionMeta = buildAppCommandOptionMeta(definition.name);
    const supportedOptionNames = new Set(Object.keys(optionMeta));
    const inlineOptionNames = Object.keys(options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {});
    const unknownInlineOptionNames = inlineOptionNames.filter((optionName) => !supportedOptionNames.has(optionName));
    if (unknownInlineOptionNames.length > 0) {
      throw createCliError(
        `Unknown option${unknownInlineOptionNames.length === 1 ? "" : "s"} for jskit app ${definition.name}: ${unknownInlineOptionNames.map((optionName) => `--${optionName}`).join(", ")}.`,
        {
          renderUsage: () => renderAppHelp(stderr, definition)
        }
      );
    }
    if (options?.dryRun === true && !supportedOptionNames.has("dry-run")) {
      throw createCliError(`Unknown option for jskit app ${definition.name}: --dry-run.`, {
        renderUsage: () => renderAppHelp(stderr, definition)
      });
    }

    if (positional.length > 1) {
      throw createCliError(`Unexpected positional arguments for jskit app ${definition.name}: ${positional.slice(1).join(" ")}`, {
        renderUsage: () => renderAppHelp(stderr, definition)
      });
    }

    if (definition.name === "verify") {
      return runAppVerifyCommand(ctx, { appRoot, options, stdout, stderr });
    }
    if (definition.name === "verify-ui") {
      return runAppVerifyUiCommand(ctx, { appRoot, options, stdout, stderr });
    }
    if (definition.name === "update-packages") {
      return runAppUpdatePackagesCommand(ctx, { appRoot, options, stdout, stderr });
    }
    if (definition.name === "link-local-packages") {
      return runAppLinkLocalPackagesCommand(ctx, { appRoot, options, stdout, stderr });
    }
    if (definition.name === "release") {
      return runAppReleaseCommand(ctx, { appRoot, options, stdout, stderr });
    }
    if (definition.name === "adopt-managed-scripts") {
      return runAppAdoptManagedScriptsCommand(ctx, { appRoot, options, stdout, stderr });
    }

    throw createCliError(`Unhandled app subcommand: ${definition.name}.`, {
      renderUsage: () => renderAppHelp(stderr, definition)
    });
  }

  return {
    commandApp
  };
}

export { createAppCommands };
