import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import {
  createColorFormatter,
  renderInlineCodeSpans,
  writeWrappedLines
} from "../../shared/outputFormatting.js";

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";
const HELP_TEXT_BY_KEY = Object.freeze({
  "page-target-file":
    "Vue page file relative to src/pages/. It must resolve to a configured surface.",
  "existing-page-target-file":
    "Existing Vue page file relative to src/pages/. It must resolve to a configured surface.",
  "existing-vue-sfc-target-file":
    "Existing Vue SFC path relative to app root.",
  "crud-target-root":
    "Route root directory relative to src/pages/ (example: admin/products)."
});

function isHelpToken(value = "") {
  return String(value || "").trim().toLowerCase() === "help";
}

function toShortPackageId(packageId = "") {
  const normalized = String(packageId || "").trim();
  if (!normalized.startsWith(JSKIT_SCOPE_PREFIX)) {
    return normalized;
  }
  return normalized.slice(JSKIT_SCOPE_PREFIX.length);
}

function resolvePackageSummary(entry = {}) {
  const descriptor = ensureObject(entry?.descriptor);
  return String(descriptor.description || "").trim();
}

function resolveHelpText(rawValue = "", helpTextKey = "") {
  const normalizedValue = String(rawValue || "").trim();
  if (normalizedValue) {
    return normalizedValue;
  }

  return String(HELP_TEXT_BY_KEY[String(helpTextKey || "").trim()] || "").trim();
}

function buildPackageOptionRows(packageEntry = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  const optionSchemas = ensureObject(descriptor.options);
  const rows = [];

  for (const optionName of sortStrings(Object.keys(optionSchemas))) {
    const schema = ensureObject(optionSchemas[optionName]);
    rows.push(Object.freeze({
      name: optionName,
      required: schema.required === true,
      inputType: String(schema.inputType || "text").trim() || "text",
      defaultValue: String(schema.defaultValue || "").trim(),
      allowEmpty: schema.allowEmpty === true,
      promptLabel: String(schema.promptLabel || "").trim(),
      promptHint: String(schema.promptHint || "").trim(),
      helpLabel: resolveHelpText(schema.helpLabel, schema.helpLabelKey),
      helpHint: resolveHelpText(schema.helpHint, schema.helpHintKey)
    }));
  }

  rows.sort((left, right) => {
    if (left.required !== right.required) {
      return left.required ? -1 : 1;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  return rows;
}

function normalizeSubcommandPositionalArgRows(rawRows = []) {
  const rows = [];
  for (const rawRow of ensureArray(rawRows)) {
    if (typeof rawRow === "string") {
      const name = String(rawRow || "").trim();
      if (!name) {
        continue;
      }
      rows.push(Object.freeze({
        name,
        required: true,
        description: ""
      }));
      continue;
    }

    const row = ensureObject(rawRow);
    const name = String(row.name || "").trim();
    if (!name) {
      continue;
    }
    rows.push(Object.freeze({
      name,
      required: row.required !== false,
      description: resolveHelpText(row.description, row.descriptionKey)
    }));
  }
  return rows;
}

function normalizeSubcommandOptionNames(rawOptionNames = []) {
  const seen = new Set();
  const rows = [];
  for (const rawOptionName of ensureArray(rawOptionNames)) {
    const optionName = String(rawOptionName || "").trim();
    if (!optionName || seen.has(optionName)) {
      continue;
    }
    seen.add(optionName);
    rows.push(optionName);
  }
  return rows;
}

function normalizeHelpExampleRows(rawRows = []) {
  const rows = [];

  for (const rawRow of ensureArray(rawRows)) {
    if (typeof rawRow === "string") {
      const lines = String(rawRow)
        .split(/\r?\n/u)
        .map((value) => value.replace(/[ \t]+$/u, ""))
        .filter((value) => value.trim().length > 0);
      if (lines.length < 1) {
        continue;
      }
      rows.push(Object.freeze({
        label: "",
        lines
      }));
      continue;
    }

    const row = ensureObject(rawRow);
    const label = String(row.label || "").trim();
    const commandLines = String(row.command || "")
      .split(/\r?\n/u)
      .map((value) => value.replace(/[ \t]+$/u, ""))
      .filter((value) => value.trim().length > 0);
    const explicitLines = ensureArray(row.lines)
      .map((value) => String(value || "").replace(/[ \t]+$/u, ""))
      .filter((value) => value.trim().length > 0);
    const lines = explicitLines.length > 0 ? explicitLines : commandLines;
    if (lines.length < 1) {
      continue;
    }
    rows.push(Object.freeze({
      label,
      lines
    }));
  }

  return rows;
}

function normalizeHelpNoteRows(rawRows = []) {
  const rows = [];

  for (const rawRow of ensureArray(rawRows)) {
    if (typeof rawRow === "string") {
      const note = String(rawRow || "").trim();
      if (note) {
        rows.push(note);
      }
      continue;
    }

    const row = ensureObject(rawRow);
    const note = resolveHelpText(row.text || row.note || "", row.textKey || row.noteKey);
    if (note) {
      rows.push(note);
    }
  }

  return rows;
}

function normalizeHelpParagraphRows(rawValue = "") {
  if (Array.isArray(rawValue)) {
    return normalizeHelpNoteRows(rawValue);
  }

  const sourceText = String(rawValue || "").trim();
  if (!sourceText) {
    return [];
  }

  return sourceText
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}

function appendHelpLongDescription(lines = [], rawLongDescription = "", { color = null } = {}) {
  const paragraphs = normalizeHelpParagraphRows(rawLongDescription);
  if (paragraphs.length < 1) {
    return;
  }

  lines.push("");
  lines.push(color ? color.heading("Long:") : "Long:");
  appendSeparatedBlocks(lines, paragraphs.map((paragraph) => renderInlineCodeSpans(paragraph, color)));
}

function appendHelpExamples(lines = [], exampleRows = [], { color = null } = {}) {
  const examples = ensureArray(exampleRows);
  if (examples.length < 1) {
    return;
  }

  lines.push("");
  lines.push(color ? color.heading(`Examples (${examples.length}):`) : `Examples (${examples.length}):`);
  appendSeparatedBlocks(
    lines,
    examples.map((example) => {
      const block = [];
      const label = String(example?.label || "").trim();
      if (label) {
        block.push(`- ${color ? color.item(label) : label}`);
        for (const commandLine of ensureArray(example?.lines)) {
          block.push(`  ${commandLine}`);
        }
        return block;
      }

      const commandLines = ensureArray(example?.lines);
      if (commandLines.length < 1) {
        return block;
      }
      block.push(`- ${commandLines[0]}`);
      for (const commandLine of commandLines.slice(1)) {
        block.push(`  ${commandLine}`);
      }
      return block;
    }).filter((block) => block.length > 0)
  );
}

function appendHelpNotes(lines = [], rawNotes = [], { color = null } = {}) {
  const notes = normalizeHelpNoteRows(rawNotes);
  if (notes.length < 1) {
    return;
  }

  lines.push("");
  lines.push(color ? color.heading(`Notes (${notes.length}):`) : `Notes (${notes.length}):`);
  appendSeparatedBlocks(
    lines,
    notes.map((note) => `- ${renderInlineCodeSpans(note, color)}`)
  );
}

function appendSeparatedBlocks(lines = [], blocks = []) {
  const normalizedBlocks = ensureArray(blocks);
  for (const [index, block] of normalizedBlocks.entries()) {
    if (index > 0) {
      lines.push("");
    }
    const lineList = Array.isArray(block) ? block : [block];
    for (const line of lineList) {
      lines.push(line);
    }
  }
}

function resolveGeneratorSubcommandMetadata(packageEntry = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  const metadata = ensureObject(descriptor.metadata);
  const subcommands = ensureObject(metadata.generatorSubcommands || descriptor.generatorSubcommands);
  const primarySubcommand = String(metadata.generatorPrimarySubcommand || descriptor.generatorPrimarySubcommand || "")
    .trim()
    .toLowerCase();
  const subcommandNames = new Set(sortStrings(Object.keys(subcommands)));
  if (primarySubcommand) {
    subcommandNames.add(primarySubcommand);
  }
  const rows = [];

  for (const subcommandName of sortStrings([...subcommandNames])) {
    const definition = ensureObject(subcommands[subcommandName]);
    const entrypoint = String(definition.entrypoint || "").trim();
    const exportName = String(definition.export || "runGeneratorSubcommand").trim() || "runGeneratorSubcommand";
    const name = String(subcommandName || "").trim();
    if (!name) {
      continue;
    }
    const optionNames = normalizeSubcommandOptionNames(definition.optionNames);
    const requiredOptionNames = normalizeSubcommandOptionNames(definition.requiredOptionNames);
    rows.push(Object.freeze({
      name,
      entrypoint,
      exportName,
      primary: primarySubcommand === name.toLowerCase(),
      description: String(definition.description || "").trim(),
      longDescription: normalizeHelpParagraphRows(definition.longDescription),
      positionalArgs: normalizeSubcommandPositionalArgRows(definition.positionalArgs),
      optionNames,
      requiredOptionNames,
      examples: normalizeHelpExampleRows(definition.examples),
      notes: normalizeHelpNoteRows(definition.notes)
    }));
  }

  return Object.freeze({
    primarySubcommand,
    subcommands: rows
  });
}

function formatOptionSummary(optionRow = {}, { color = null } = {}) {
  const status = optionRow.required ? "required" : "optional";
  const hasDefaultValue = String(optionRow.defaultValue || "").length > 0;
  const optionalDefaultSuffix = optionRow.required
    ? ""
    : `; default: ${hasDefaultValue ? optionRow.defaultValue : "<empty>"}`;
  const defaultSuffix = optionRow.required && hasDefaultValue
    ? `; default: ${optionRow.defaultValue}`
    : optionalDefaultSuffix;
  const allowEmptySuffix = optionRow.allowEmpty ? "; allow-empty" : "";
  const labelParts = [
    String(optionRow.helpLabel || "").trim() || String(optionRow.promptLabel || "").trim(),
    String(optionRow.helpHint || "").trim() || String(optionRow.promptHint || "").trim()
  ].filter(Boolean);
  const label = labelParts.join(". ");
  const normalizedInputType = String(optionRow.inputType || "").trim().toLowerCase();
  const typeSuffix = normalizedInputType && normalizedInputType !== "flag" && normalizedInputType !== "boolean"
    ? `<${optionRow.inputType}> `
    : "";
  const baseDescription = label || "No description provided.";
  const description = optionRow.name === "placement-component-token"
    ? `${baseDescription} Use \`jskit list-link-items\` to discover link-item tokens.`
    : baseDescription;
  const optionName = `--${optionRow.name}`;
  const renderedOptionName = color ? color.item(optionName) : optionName;
  return `- ${renderedOptionName} ${typeSuffix}[${status}${defaultSuffix}${allowEmptySuffix}]: ${renderInlineCodeSpans(description, color)}`.trim();
}

function formatPositionalArgUsageToken(arg = {}) {
  const name = String(arg.name || "").trim();
  if (!name) {
    return "";
  }
  if (arg.required === false) {
    return `[${name}]`;
  }
  return name;
}

function formatPositionalArgSummary(arg = {}, { color = null } = {}) {
  const name = String(arg.name || "").trim();
  if (!name) {
    return "";
  }
  const status = arg.required === false ? "optional" : "required";
  const description = renderInlineCodeSpans(String(arg.description || "").trim() || "No description provided.", color);
  const renderedName = color ? color.item(name) : name;
  return `- ${renderedName} [${status}]: ${description}`;
}

function findGeneratorSubcommandRow(packageEntry = {}, subcommandName = "") {
  const metadata = resolveGeneratorSubcommandMetadata(packageEntry);
  const normalizedSubcommandName = String(subcommandName || "").trim().toLowerCase();
  if (!normalizedSubcommandName) {
    return null;
  }
  for (const row of ensureArray(metadata.subcommands)) {
    if (String(row.name || "").trim().toLowerCase() === normalizedSubcommandName) {
      return row;
    }
  }
  return null;
}

function buildSubcommandOptionRows(optionRows = [], subcommandRow = {}) {
  const packageOptionRows = ensureArray(optionRows);
  const optionNames = ensureArray(subcommandRow.optionNames).map((value) => String(value || "").trim()).filter(Boolean);
  const requiredOptionNames = new Set(
    ensureArray(subcommandRow.requiredOptionNames).map((value) => String(value || "").trim()).filter(Boolean)
  );
  if (optionNames.length < 1) {
    return packageOptionRows;
  }

  const optionRowsByName = new Map();
  for (const optionRow of packageOptionRows) {
    optionRowsByName.set(String(optionRow.name || "").trim(), optionRow);
  }

  const rows = [];
  for (const optionName of optionNames) {
    const optionRow = optionRowsByName.get(optionName);
    if (optionRow) {
      if (requiredOptionNames.size > 0) {
        rows.push(Object.freeze({
          ...optionRow,
          required: requiredOptionNames.has(optionName)
        }));
      } else {
        rows.push(optionRow);
      }
    }
  }
  return rows;
}

function renderGenerateCatalogHelp({
  io,
  packageRegistry,
  resolvePackageKind,
  json = false
} = {}) {
  const generators = sortStrings([...packageRegistry.keys()])
    .map((packageId) => packageRegistry.get(packageId))
    .filter((entry) => resolvePackageKind(entry) === "generator")
    .map((entry) => {
      const packageId = String(entry?.packageId || "").trim();
      return Object.freeze({
        packageId,
        shortId: toShortPackageId(packageId),
        version: String(entry?.version || "").trim(),
        description: resolvePackageSummary(entry)
      });
    });

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "generate",
      generators,
      usage: [
        "jskit generate <generatorId> help",
        "jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...]",
        "jskit list generators"
      ]
    }, null, 2)}\n`);
    return;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(color.heading("Generate command"));
  lines.push("");
  lines.push(color.heading(`Available generators (${generators.length}):`));
  for (const generator of generators) {
    const shortIdSuffix =
      generator.shortId && generator.shortId !== generator.packageId
        ? `${color.item(generator.shortId)} `
        : "";
    const versionSuffix = generator.version ? ` (${generator.version})` : "";
    const descriptionSuffix = generator.description ? `: ${generator.description}` : "";
    lines.push(`- ${shortIdSuffix}${color.item(generator.packageId)}${versionSuffix}${descriptionSuffix}`.trim());
  }
  lines.push("");
  lines.push(color.heading("Use:"));
  lines.push("- jskit generate <generatorId> help");
  lines.push("- jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...]");
  lines.push("- jskit list generators");
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
}

function renderAddCatalogHelp({
  io,
  packageRegistry,
  bundleRegistry,
  resolvePackageKind,
  json = false
} = {}) {
  const bundles = sortStrings([...bundleRegistry.keys()]).map((bundleId) => {
    const bundle = ensureObject(bundleRegistry.get(bundleId));
    return Object.freeze({
      bundleId,
      version: String(bundle.version || "").trim(),
      description: String(bundle.description || "").trim(),
      packageCount: ensureArray(bundle.packages).length
    });
  });

  const runtimePackages = sortStrings([...packageRegistry.keys()])
    .map((packageId) => packageRegistry.get(packageId))
    .filter((entry) => resolvePackageKind(entry) === "runtime")
    .map((entry) => {
      const packageId = String(entry?.packageId || "").trim();
      return Object.freeze({
        packageId,
        shortId: toShortPackageId(packageId),
        version: String(entry?.version || "").trim(),
        description: resolvePackageSummary(entry)
      });
    });

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "add",
      bundles,
      runtimePackages,
      usage: [
        "jskit add package <packageId> help",
        "jskit add bundle <bundleId> help",
        "jskit add package <packageId> [--<option> <value>...]",
        "jskit add bundle <bundleId> [--<option> <value>...]"
      ]
    }, null, 2)}\n`);
    return;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(color.heading("Add command"));
  lines.push("");
  lines.push(color.heading(`Available bundles (${bundles.length}):`));
  for (const bundle of bundles) {
    const versionSuffix = bundle.version ? ` (${bundle.version})` : "";
    const countSuffix = ` [packages:${bundle.packageCount}]`;
    const descriptionSuffix = bundle.description ? `: ${bundle.description}` : "";
    lines.push(`- ${color.item(bundle.bundleId)}${versionSuffix}${countSuffix}${descriptionSuffix}`);
  }
  lines.push("");
  lines.push(color.heading(`Available runtime packages (${runtimePackages.length}):`));
  for (const runtimePackage of runtimePackages) {
    const shortIdSuffix =
      runtimePackage.shortId && runtimePackage.shortId !== runtimePackage.packageId
        ? `${color.item(runtimePackage.shortId)} `
        : "";
    const versionSuffix = runtimePackage.version ? ` (${runtimePackage.version})` : "";
    const descriptionSuffix = runtimePackage.description ? `: ${runtimePackage.description}` : "";
    lines.push(`- ${shortIdSuffix}${color.item(runtimePackage.packageId)}${versionSuffix}${descriptionSuffix}`.trim());
  }
  lines.push("");
  lines.push(color.heading("Use:"));
  lines.push("- jskit add package <packageId> help");
  lines.push("- jskit add bundle <bundleId> help");
  lines.push("- jskit add package <packageId> [--<option> <value>...]");
  lines.push("- jskit add bundle <bundleId> [--<option> <value>...]");
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
}

function renderGeneratePackageHelp({
  io,
  packageEntry,
  packageIdInput = "",
  json = false
} = {}) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const summary = resolvePackageSummary(packageEntry);
  const optionRows = buildPackageOptionRows(packageEntry);
  const generatorMetadata = resolveGeneratorSubcommandMetadata(packageEntry);
  const primarySubcommandRow = ensureArray(generatorMetadata.subcommands).find((row) => row.primary) || null;
  const preferredId = toShortPackageId(packageId) || packageId;
  const usage = Object.freeze([
    `jskit generate ${preferredId} help`,
    `jskit generate ${preferredId} <subcommand> help`,
    `jskit generate ${preferredId} [subcommand] [subcommand args...] [--<option> <value>...]`
  ]);
  const resolvedFrom = String(packageIdInput || "").trim();
  const resolvedFromLabel = resolvedFrom && resolvedFrom !== packageId ? resolvedFrom : "";

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "generate",
      targetType: "generator",
      packageId,
      resolvedFrom: resolvedFromLabel,
      description: summary,
      usage,
      primarySubcommand: generatorMetadata.primarySubcommand || "",
      subcommands: generatorMetadata.subcommands,
      primarySubcommandExamples: ensureArray(primarySubcommandRow?.examples),
      options: optionRows
    }, null, 2)}\n`);
    return;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(`Generator help: ${color.emphasis(packageId)}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${color.item(resolvedFromLabel)}`);
  }
  if (summary) {
    lines.push(`Description: ${summary}`);
  }
  lines.push("");
  lines.push(color.heading("Use:"));
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");

  const subcommands = ensureArray(generatorMetadata.subcommands);
  const shouldShowPackageExamples = subcommands.length < 1;
  const shouldShowPackageOptions = subcommands.length < 1;
  const hasRequiredWithDefaults = optionRows.some((row) => row.required && row.defaultValue);
  if (subcommands.length > 0) {
    lines.push(color.heading(`Subcommands (${subcommands.length}):`));
    for (const subcommand of subcommands) {
      const primarySuffix = subcommand.primary ? color.dim(" [primary]") : "";
      const descriptionSuffix = subcommand.description ? `: ${subcommand.description}` : "";
      lines.push(`- ${color.item(subcommand.name)}${primarySuffix}${descriptionSuffix}`);
    }
    lines.push("");
    lines.push("Use subcommand help for positional args, options, notes, and examples:");
    lines.push(`  ${color.item("jskit generate <generatorId> <subcommand> help")}`);
  }

  if (shouldShowPackageExamples) {
    appendHelpExamples(lines, primarySubcommandRow?.examples, { color });
  }
  if (shouldShowPackageOptions) {
    lines.push("");
    lines.push(color.heading(`Options (${optionRows.length}):`));
    if (optionRows.length > 0) {
      for (const optionRow of optionRows) {
        lines.push(formatOptionSummary(optionRow, { color }));
      }
    } else {
      lines.push("- No inline options.");
    }
    if (hasRequiredWithDefaults) {
      lines.push("");
      lines.push("Note: required options with defaults are auto-filled when omitted.");
    }
  }
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
}

function renderGenerateSubcommandHelp({
  io,
  packageEntry,
  packageIdInput = "",
  subcommandName = "",
  json = false
} = {}) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const summary = resolvePackageSummary(packageEntry);
  const optionRows = buildPackageOptionRows(packageEntry);
  const preferredId = toShortPackageId(packageId) || packageId;
  const normalizedSubcommandName = String(subcommandName || "").trim();
  const subcommandRow = findGeneratorSubcommandRow(packageEntry, normalizedSubcommandName);
  if (!subcommandRow) {
    return false;
  }

  const resolvedFrom = String(packageIdInput || "").trim();
  const resolvedFromLabel = resolvedFrom && resolvedFrom !== packageId ? resolvedFrom : "";
  const description = String(subcommandRow.description || "").trim();
  const effectiveDescription = description || (
    subcommandRow.primary
      ? "Primary generator command."
      : "No description provided."
  );
  const positionalArgs = ensureArray(subcommandRow.positionalArgs);
  const positionalArgTokens = positionalArgs
    .map((arg) => formatPositionalArgUsageToken(arg))
    .filter(Boolean);
  const invocationLine = `jskit generate ${preferredId} ${subcommandRow.name}${positionalArgTokens.length > 0
    ? ` ${positionalArgTokens.join(" ")}`
    : ""} [--<option> <value>...]`;
  const usage = Object.freeze([
    invocationLine,
    `jskit generate ${preferredId} ${subcommandRow.name} help`
  ]);
  const subcommandOptionRows = buildSubcommandOptionRows(optionRows, subcommandRow);
  const hasRequiredWithDefaults = subcommandOptionRows.some((row) => row.required && row.defaultValue);

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "generate",
      targetType: "generator-subcommand-help",
      packageId,
      resolvedFrom: resolvedFromLabel,
      generatorDescription: summary,
      subcommand: {
        name: subcommandRow.name,
        primary: subcommandRow.primary,
        description: effectiveDescription,
        longDescription: ensureArray(subcommandRow.longDescription),
        positionalArgs,
        examples: ensureArray(subcommandRow.examples),
        notes: ensureArray(subcommandRow.notes),
        options: subcommandOptionRows
      },
      usage
    }, null, 2)}\n`);
    return true;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(`Generator subcommand help: ${color.emphasis(packageId)} ${color.item(subcommandRow.name)}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${color.item(resolvedFromLabel)}`);
  }
  lines.push(`Description: ${renderInlineCodeSpans(effectiveDescription, color)}`);
  appendHelpLongDescription(lines, subcommandRow.longDescription, { color });
  lines.push("");
  lines.push(color.heading("Use:"));
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");
  lines.push(color.heading(`Positional args (${positionalArgs.length}):`));
  if (positionalArgs.length > 0) {
    appendSeparatedBlocks(
      lines,
      positionalArgs.map((positionalArg) => formatPositionalArgSummary(positionalArg, { color }))
    );
  } else {
    lines.push("- No positional arguments.");
  }
  appendHelpExamples(lines, subcommandRow.examples, { color });
  appendHelpNotes(lines, subcommandRow.notes, { color });
  lines.push("");
  lines.push(color.heading(`Options (${subcommandOptionRows.length}):`));
  if (subcommandOptionRows.length > 0) {
    appendSeparatedBlocks(
      lines,
      subcommandOptionRows.map((optionRow) => formatOptionSummary(optionRow, { color }))
    );
  } else {
    lines.push("- No inline options.");
  }
  if (hasRequiredWithDefaults) {
    lines.push("");
    lines.push("Note: required options with defaults are auto-filled when omitted.");
  }
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
  return true;
}

function renderAddPackageHelp({
  io,
  packageEntry,
  packageIdInput = "",
  json = false
} = {}) {
  const packageId = String(packageEntry?.packageId || "").trim();
  const summary = resolvePackageSummary(packageEntry);
  const optionRows = buildPackageOptionRows(packageEntry);
  const preferredId = toShortPackageId(packageId) || packageId;
  const usage = Object.freeze([
    `jskit add package ${preferredId} help`,
    `jskit add package ${preferredId} [--<option> <value>...]`
  ]);
  const resolvedFrom = String(packageIdInput || "").trim();
  const resolvedFromLabel = resolvedFrom && resolvedFrom !== packageId ? resolvedFrom : "";
  const hasRequiredWithDefaults = optionRows.some((row) => row.required && row.defaultValue);

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "add",
      targetType: "package",
      packageId,
      resolvedFrom: resolvedFromLabel,
      description: summary,
      usage,
      options: optionRows
    }, null, 2)}\n`);
    return;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(`Package help: ${color.emphasis(packageId)}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${color.item(resolvedFromLabel)}`);
  }
  if (summary) {
    lines.push(`Description: ${summary}`);
  }
  lines.push("");
  lines.push(color.heading("Use:"));
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");
  lines.push(color.heading(`Options (${optionRows.length}):`));
  if (optionRows.length > 0) {
    appendSeparatedBlocks(
      lines,
      optionRows.map((optionRow) => formatOptionSummary(optionRow, { color }))
    );
  } else {
    lines.push("- No inline options.");
  }
  if (hasRequiredWithDefaults) {
    lines.push("");
    lines.push("Note: required options with defaults are auto-filled when omitted.");
  }
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
}

function renderAddBundleHelp({
  io,
  bundleId = "",
  bundle = {},
  json = false
} = {}) {
  const normalizedBundle = ensureObject(bundle);
  const packageIds = ensureArray(normalizedBundle.packages).map((value) => String(value || "").trim()).filter(Boolean);
  const description = String(normalizedBundle.description || "").trim();
  const usage = Object.freeze([
    `jskit add bundle ${bundleId} help`,
    `jskit add bundle ${bundleId} [--<option> <value>...]`,
    "jskit add package <packageId> help"
  ]);

  if (json) {
    io.stdout.write(`${JSON.stringify({
      command: "add",
      targetType: "bundle",
      bundleId,
      description,
      packages: packageIds,
      usage
    }, null, 2)}\n`);
    return;
  }

  const color = createColorFormatter(io.stdout);
  const lines = [];
  lines.push(`Bundle help: ${color.emphasis(bundleId)}`);
  if (description) {
    lines.push(`Description: ${description}`);
  }
  lines.push("");
  lines.push(color.heading(`Included packages (${packageIds.length}):`));
  for (const packageId of packageIds) {
    lines.push(`- ${color.item(packageId)}`);
  }
  lines.push("");
  lines.push(color.heading("Inline options:"));
  appendSeparatedBlocks(lines, [
    "- Bundles do not define direct options.",
    "- Pass package options through using --<option> <value>.",
    "- Use package help to inspect option contracts for included packages."
  ]);
  lines.push("");
  lines.push(color.heading("Use:"));
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  writeWrappedLines({
    stdout: io.stdout,
    lines
  });
}

export {
  isHelpToken,
  renderGenerateCatalogHelp,
  renderAddCatalogHelp,
  renderGeneratePackageHelp,
  renderGenerateSubcommandHelp,
  renderAddPackageHelp,
  renderAddBundleHelp
};
