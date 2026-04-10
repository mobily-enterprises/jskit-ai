import path from "node:path";
import { resolveRequiredAppRoot, toPosixPath } from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const PLACEMENT_FILE = "src/placement.js";

function requireSinglePositionalTargetFile(args = [], { context = "assistant" } = {}) {
  const positionalArgs = Array.isArray(args) ? args.map((value) => normalizeText(value)).filter(Boolean) : [];
  if (positionalArgs.length !== 1) {
    throw new Error(`${context} requires exactly one <target-file> positional argument.`);
  }

  return positionalArgs[0];
}

function rejectUnexpectedOptions(options = {}, allowedOptionNames = [], { context = "assistant" } = {}) {
  const allowedOptionNameSet = new Set(
    (Array.isArray(allowedOptionNames) ? allowedOptionNames : [])
      .map((optionName) => normalizeText(optionName))
      .filter(Boolean)
  );

  const unexpectedOptions = Object.keys(options || {})
    .map((optionName) => normalizeText(optionName))
    .filter(Boolean)
    .filter((optionName) => !allowedOptionNameSet.has(optionName))
    .sort((left, right) => left.localeCompare(right));

  if (unexpectedOptions.length < 1) {
    return;
  }

  throw new Error(
    `${context} received unsupported option${unexpectedOptions.length > 1 ? "s" : ""}: ${unexpectedOptions.map((optionName) => `--${optionName}`).join(", ")}.`
  );
}

function resolvePathWithinApp(appRoot, targetPath, { context = "assistant" } = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context
  });

  const normalizedTargetPath = normalizeText(targetPath);
  if (!normalizedTargetPath) {
    throw new Error(`${context} requires target path.`);
  }

  const absolutePath = path.resolve(resolvedAppRoot, normalizedTargetPath);
  const relativePath = path.relative(resolvedAppRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${context} target path must stay within app root: ${normalizedTargetPath}`);
  }

  return Object.freeze({
    absolutePath,
    relativePath: toPosixPath(relativePath)
  });
}

function ensureTrailingNewline(value = "") {
  const source = String(value || "");
  return source.endsWith("\n") ? source : `${source}\n`;
}

function appendBlockIfMarkerMissing(source = "", marker = "", block = "") {
  const normalizedMarker = String(marker || "").trim();
  const normalizedBlock = String(block || "").trim();
  const sourceText = String(source || "");
  if (!normalizedMarker || !normalizedBlock || sourceText.includes(normalizedMarker)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  return {
    changed: true,
    content: `${ensureTrailingNewline(sourceText)}${normalizedBlock}\n`
  };
}

function requireManagedOrEmptyPageSource(existingSource = "", expectedSource = "", targetRelativePath = "", { context = "assistant" } = {}) {
  const sourceText = String(existingSource || "");
  if (!sourceText) {
    return;
  }
  if (sourceText === String(expectedSource || "")) {
    return;
  }

  throw new Error(
    `${context} will not overwrite existing page ${targetRelativePath}. Move it or choose an empty target file.`
  );
}

export {
  PLACEMENT_FILE,
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions,
  resolvePathWithinApp,
  appendBlockIfMarkerMissing,
  requireManagedOrEmptyPageSource
};
