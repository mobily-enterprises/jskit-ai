import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";

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
      promptHint: String(schema.promptHint || "").trim()
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
      description: String(row.description || "").trim()
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
      positionalArgs: normalizeSubcommandPositionalArgRows(definition.positionalArgs),
      optionNames,
      requiredOptionNames
    }));
  }

  return Object.freeze({
    primarySubcommand,
    subcommands: rows
  });
}

function formatOptionSummary(optionRow = {}) {
  const status = optionRow.required ? "required" : "optional";
  const hasDefaultValue = String(optionRow.defaultValue || "").length > 0;
  const optionalDefaultSuffix = optionRow.required
    ? ""
    : `; default: ${hasDefaultValue ? optionRow.defaultValue : "<empty>"}`;
  const defaultSuffix = optionRow.required && hasDefaultValue
    ? `; default: ${optionRow.defaultValue}`
    : optionalDefaultSuffix;
  const allowEmptySuffix = optionRow.allowEmpty ? "; allow-empty" : "";
  const labelParts = [optionRow.promptLabel, optionRow.promptHint].filter(Boolean);
  const label = labelParts.join(". ");
  const typeSuffix = optionRow.inputType ? `<${optionRow.inputType}> ` : "";
  const baseDescription = label || "No description provided.";
  const description = optionRow.name === "placement-component-token"
    ? `${baseDescription} Use jskit list-link-items to discover link-item tokens.`
    : baseDescription;
  return `- --${optionRow.name} ${typeSuffix}[${status}${defaultSuffix}${allowEmptySuffix}]: ${description}`.trim();
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

function formatPositionalArgSummary(arg = {}) {
  const name = String(arg.name || "").trim();
  if (!name) {
    return "";
  }
  const status = arg.required === false ? "optional" : "required";
  const description = String(arg.description || "").trim() || "No description provided.";
  return `- ${name} [${status}]: ${description}`;
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

  const lines = [];
  lines.push("Generate command");
  lines.push("");
  lines.push(`Available generators (${generators.length}):`);
  for (const generator of generators) {
    const shortIdSuffix =
      generator.shortId && generator.shortId !== generator.packageId ? `${generator.shortId} ` : "";
    const versionSuffix = generator.version ? ` (${generator.version})` : "";
    const descriptionSuffix = generator.description ? `: ${generator.description}` : "";
    lines.push(`- ${shortIdSuffix}${generator.packageId}${versionSuffix}${descriptionSuffix}`.trim());
  }
  lines.push("");
  lines.push("Use:");
  lines.push("- jskit generate <generatorId> help");
  lines.push("- jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...]");
  lines.push("- jskit list generators");
  io.stdout.write(`${lines.join("\n")}\n`);
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

  const lines = [];
  lines.push("Add command");
  lines.push("");
  lines.push(`Available bundles (${bundles.length}):`);
  for (const bundle of bundles) {
    const versionSuffix = bundle.version ? ` (${bundle.version})` : "";
    const countSuffix = ` [packages:${bundle.packageCount}]`;
    const descriptionSuffix = bundle.description ? `: ${bundle.description}` : "";
    lines.push(`- ${bundle.bundleId}${versionSuffix}${countSuffix}${descriptionSuffix}`);
  }
  lines.push("");
  lines.push(`Available runtime packages (${runtimePackages.length}):`);
  for (const runtimePackage of runtimePackages) {
    const shortIdSuffix =
      runtimePackage.shortId && runtimePackage.shortId !== runtimePackage.packageId
        ? `${runtimePackage.shortId} `
        : "";
    const versionSuffix = runtimePackage.version ? ` (${runtimePackage.version})` : "";
    const descriptionSuffix = runtimePackage.description ? `: ${runtimePackage.description}` : "";
    lines.push(`- ${shortIdSuffix}${runtimePackage.packageId}${versionSuffix}${descriptionSuffix}`.trim());
  }
  lines.push("");
  lines.push("Use:");
  lines.push("- jskit add package <packageId> help");
  lines.push("- jskit add bundle <bundleId> help");
  lines.push("- jskit add package <packageId> [--<option> <value>...]");
  lines.push("- jskit add bundle <bundleId> [--<option> <value>...]");
  io.stdout.write(`${lines.join("\n")}\n`);
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
  const preferredId = toShortPackageId(packageId) || packageId;
  const usage = Object.freeze([
    `jskit generate ${preferredId} help`,
    `jskit generate ${preferredId} help <subcommand>`,
    `jskit generate ${preferredId} <subcommand> help`,
    `jskit generate ${preferredId} [subcommand] [subcommand args...] [--<option> <value>...]`
  ]);
  const resolvedFrom = String(packageIdInput || "").trim();
  const resolvedFromLabel = resolvedFrom && resolvedFrom !== packageId ? resolvedFrom : "";
  const hasRequiredWithDefaults = optionRows.some((row) => row.required && row.defaultValue);

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
      options: optionRows
    }, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push(`Generator help: ${packageId}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${resolvedFromLabel}`);
  }
  if (summary) {
    lines.push(`Description: ${summary}`);
  }
  lines.push("");
  lines.push("Use:");
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");

  const subcommands = ensureArray(generatorMetadata.subcommands);
  if (subcommands.length > 0) {
    lines.push(`Subcommands (${subcommands.length}):`);
    for (const subcommand of subcommands) {
      const primarySuffix = subcommand.primary ? " [primary]" : "";
      const descriptionSuffix = subcommand.description ? `: ${subcommand.description}` : "";
      lines.push(`- ${subcommand.name}${primarySuffix}${descriptionSuffix}`);
    }
    lines.push("- Use subcommand help for details: jskit generate <generatorId> <subcommand> help");
    lines.push("");
  }

  lines.push(`Options (${optionRows.length}):`);
  if (optionRows.length > 0) {
    for (const optionRow of optionRows) {
      lines.push(formatOptionSummary(optionRow));
    }
  } else {
    lines.push("- No inline options.");
  }
  if (hasRequiredWithDefaults) {
    lines.push("");
    lines.push("Note: required options with defaults are auto-filled when omitted.");
  }
  io.stdout.write(`${lines.join("\n")}\n`);
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
        positionalArgs,
        options: subcommandOptionRows
      },
      usage
    }, null, 2)}\n`);
    return true;
  }

  const lines = [];
  lines.push(`Generator subcommand help: ${packageId} ${subcommandRow.name}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${resolvedFromLabel}`);
  }
  if (summary) {
    lines.push(`Generator: ${summary}`);
  }
  lines.push(`Description: ${effectiveDescription}`);
  if (subcommandRow.primary) {
    lines.push("Note: this is the primary generator command (same behavior as running without a subcommand).");
  }
  lines.push("");
  lines.push("Use:");
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");
  lines.push(`Positional args (${positionalArgs.length}):`);
  if (positionalArgs.length > 0) {
    for (const positionalArg of positionalArgs) {
      lines.push(formatPositionalArgSummary(positionalArg));
    }
  } else {
    lines.push("- No positional arguments.");
  }
  lines.push("");
  lines.push(`Options (${subcommandOptionRows.length}):`);
  if (subcommandOptionRows.length > 0) {
    for (const optionRow of subcommandOptionRows) {
      lines.push(formatOptionSummary(optionRow));
    }
  } else {
    lines.push("- No inline options.");
  }
  if (hasRequiredWithDefaults) {
    lines.push("");
    lines.push("Note: required options with defaults are auto-filled when omitted.");
  }
  io.stdout.write(`${lines.join("\n")}\n`);
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

  const lines = [];
  lines.push(`Package help: ${packageId}`);
  if (resolvedFromLabel) {
    lines.push(`Resolved from: ${resolvedFromLabel}`);
  }
  if (summary) {
    lines.push(`Description: ${summary}`);
  }
  lines.push("");
  lines.push("Use:");
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  lines.push("");
  lines.push(`Options (${optionRows.length}):`);
  if (optionRows.length > 0) {
    for (const optionRow of optionRows) {
      lines.push(formatOptionSummary(optionRow));
    }
  } else {
    lines.push("- No inline options.");
  }
  if (hasRequiredWithDefaults) {
    lines.push("");
    lines.push("Note: required options with defaults are auto-filled when omitted.");
  }
  io.stdout.write(`${lines.join("\n")}\n`);
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

  const lines = [];
  lines.push(`Bundle help: ${bundleId}`);
  if (description) {
    lines.push(`Description: ${description}`);
  }
  lines.push("");
  lines.push(`Included packages (${packageIds.length}):`);
  for (const packageId of packageIds) {
    lines.push(`- ${packageId}`);
  }
  lines.push("");
  lines.push("Inline options:");
  lines.push("- Bundles do not define direct options.");
  lines.push("- Pass package options through using --<option> <value>.");
  lines.push("- Use package help to inspect option contracts for included packages.");
  lines.push("");
  lines.push("Use:");
  for (const usageLine of usage) {
    lines.push(`- ${usageLine}`);
  }
  io.stdout.write(`${lines.join("\n")}\n`);
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
