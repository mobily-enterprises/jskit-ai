import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";

function writePackageExportsSection({
  payload,
  options,
  stdout,
  color,
  wrapWidth,
  normalizeRelativePosixPath,
  shouldShowPackageExportTarget,
  classifyExportedSymbols,
  writeWrappedItems
} = {}) {
  const introspection = ensureObject(payload.introspection);
  const introspectionAvailable = introspection.available === true;

  if (!introspectionAvailable) {
    stdout.write(`${color.heading("Code introspection:")}\n`);
    stdout.write(`- ${color.dim("Source files unavailable (descriptor metadata only).")}\n`);
    return;
  }

  const packageExports = ensureArray(payload.packageExports);
  const exportedSymbols = ensureArray(payload.exportedSymbols);
  const exportedSymbolsByFile = new Map(
    exportedSymbols
      .map((entry) => ensureObject(entry))
      .map((entry) => {
        const file = normalizeRelativePosixPath(String(entry.file || "").trim());
        return file ? [file, entry] : null;
      })
      .filter(Boolean)
  );

  stdout.write(`${color.heading(`Package exports (${packageExports.length}):`)}\n`);
  if (packageExports.length < 1) {
    stdout.write(`- ${color.dim("none declared")}\n`);
    return;
  }

  const symbolDetailsShown = new Set();
  for (const packageExport of packageExports) {
    const record = ensureObject(packageExport);
    const subpath = String(record.subpath || ".").trim() || ".";
    const condition = String(record.condition || "default").trim() || "default";
    const target = String(record.target || "").trim();
    const targetType = String(record.targetType || "").trim();
    const conditionSuffix = condition !== "default" ? ` ${color.installed(`[${condition}]`)}` : "";
    const status = targetType === "file"
      ? record.targetExists === true
        ? color.installed("[ok]")
        : color.provider("[missing]")
      : targetType === "pattern"
        ? color.dim("[pattern]")
        : color.dim("[external]");
    const showTarget = shouldShowPackageExportTarget({ subpath, target, targetType });
    const targetSuffix = showTarget ? ` -> ${color.item(target)}` : "";
    const subpathLabel = options.details ? color.white(subpath) : color.item(subpath);
    stdout.write(`- ${subpathLabel}${conditionSuffix}${targetSuffix} ${status}\n`);

    if (!options.details) {
      continue;
    }
    if (targetType !== "file" || !target.startsWith("./")) {
      continue;
    }

    const normalizedTarget = normalizeRelativePosixPath(target.slice(2));
    const summary = ensureObject(exportedSymbolsByFile.get(normalizedTarget));
    if (!summary || Object.keys(summary).length < 1) {
      continue;
    }

    const detailKey = `${subpath}::${normalizedTarget}`;
    if (symbolDetailsShown.has(detailKey)) {
      continue;
    }
    symbolDetailsShown.add(detailKey);

    const symbols = ensureArray(summary.symbols).map((value) => String(value)).filter(Boolean);
    const classifiedSymbols = classifyExportedSymbols(symbols);
    writeClassifiedSymbols({
      label: "providers",
      entries: classifiedSymbols.providers,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });
    writeClassifiedSymbols({
      label: "functions/helpers",
      entries: classifiedSymbols.functions,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });
    writeClassifiedSymbols({
      label: "constants",
      entries: classifiedSymbols.constants,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });
    writeClassifiedSymbols({
      label: "classes/types",
      entries: classifiedSymbols.classesOrTypes,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });
    writeClassifiedSymbols({
      label: "internal/test hooks",
      entries: classifiedSymbols.internals,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });
    writeClassifiedSymbols({
      label: "other symbols",
      entries: classifiedSymbols.others,
      stdout,
      color,
      wrapWidth,
      writeWrappedItems
    });

    if (summary.hasDefaultExport === true) {
      stdout.write(`  ${color.installed("default export: yes")}\n`);
    }
    const starReExports = ensureArray(summary.starReExports).map((value) => String(value)).filter(Boolean);
    const namedReExports = ensureArray(summary.namedReExports).map((value) => String(value)).filter(Boolean);
    const reExportSummary = [];
    if (namedReExports.length > 0) {
      reExportSummary.push(`named from ${namedReExports.length} files`);
    }
    if (starReExports.length > 0) {
      reExportSummary.push(`star from ${starReExports.length} files`);
    }
    if (options.debugExports && reExportSummary.length > 0) {
      stdout.write(`  ${color.dim(`re-export sources: ${reExportSummary.join(", ")}`)}\n`);
    }

    if (options.debugExports && starReExports.length > 0) {
      writeWrappedItems({
        stdout,
        heading: `  ${color.installed(`star re-exports (${starReExports.length}):`)}`,
        lineIndent: "    ",
        wrapWidth,
        items: starReExports.map((specifier) => ({
          text: specifier,
          rendered: color.item(specifier)
        }))
      });
    }
    if (options.debugExports && namedReExports.length > 0) {
      writeWrappedItems({
        stdout,
        heading: `  ${color.installed(`named re-exports (${namedReExports.length}):`)}`,
        lineIndent: "    ",
        wrapWidth,
        items: namedReExports.map((specifier) => ({
          text: specifier,
          rendered: color.item(specifier)
        }))
      });
    }
  }
}

function writeClassifiedSymbols({
  label,
  entries,
  stdout,
  color,
  wrapWidth,
  writeWrappedItems
} = {}) {
  const items = ensureArray(entries).map((entry) => String(entry || "").trim()).filter(Boolean);
  if (items.length < 1) {
    return;
  }
  writeWrappedItems({
    stdout,
    heading: `  ${color.installed(`${label} (${items.length}):`)}`,
    lineIndent: "    ",
    wrapWidth,
    items: items.map((symbol) => ({
      text: symbol,
      rendered: color.item(symbol)
    }))
  });
}

export {
  writePackageExportsSection
};
