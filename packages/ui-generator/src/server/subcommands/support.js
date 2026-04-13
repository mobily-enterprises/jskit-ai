import path from "node:path";
import {
  resolveRequiredAppRoot,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import { normalizeShellOutletTargetId } from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toCamelCase, toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_COMPONENT_DIRECTORY = "src/components";
const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const PLACEMENT_FILE = "src/placement.js";
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SCRIPT_SETUP_ATTRIBUTE_PATTERN = /\bsetup\b/i;
const ATTRIBUTE_PATTERN = /([:@]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function toKebabCase(value = "") {
  return toSnakeCase(value).replaceAll("_", "-");
}

function toPascalCase(value = "") {
  const camel = toCamelCase(toSnakeCase(value));
  if (!camel) {
    return "";
  }

  return `${camel.slice(0, 1).toUpperCase()}${camel.slice(1)}`;
}

function requireOption(options = {}, optionName = "", { context = "ui-generator" } = {}) {
  const optionValue = normalizeText(options?.[optionName]);
  if (!optionValue) {
    throw new Error(`${context} requires --${optionName}.`);
  }

  return optionValue;
}

function requireSinglePositionalTargetFile(args = [], { context = "ui-generator" } = {}) {
  const positionalArgs = Array.isArray(args) ? args.map((value) => normalizeText(value)).filter(Boolean) : [];
  if (positionalArgs.length !== 1) {
    throw new Error(`${context} requires exactly one <target-file> positional argument.`);
  }

  return positionalArgs[0];
}

function resolveOutletTargetId(
  rawTarget = "",
  {
    context = "ui-generator",
    optionName = "target"
  } = {}
) {
  const normalizedTarget = normalizeText(rawTarget);
  if (!normalizedTarget) {
    throw new Error(`${context} requires --${optionName}.`);
  }

  const targetId = normalizeShellOutletTargetId(normalizedTarget);
  if (!targetId) {
    throw new Error(`${context} option "${optionName}" must be a target in "host:position" format.`);
  }

  return Object.freeze({
    id: targetId
  });
}

function rejectUnexpectedOptions(options = {}, allowedOptionNames = [], { context = "ui-generator" } = {}) {
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

function resolvePathWithinApp(appRoot, targetPath, { context = "ui-generator" } = {}) {
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

function insertImportIfMissing(source = "", importLine = "") {
  const normalizedImportLine = String(importLine || "").trim();
  if (!normalizedImportLine) {
    return {
      changed: false,
      content: String(source || "")
    };
  }

  const sourceText = String(source || "");
  if (sourceText.includes(normalizedImportLine)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const importPattern = /^import\s+[^;]+;\s*$/gm;
  let match = null;
  let insertionIndex = 0;
  while ((match = importPattern.exec(sourceText)) !== null) {
    insertionIndex = match.index + match[0].length;
  }

  if (insertionIndex > 0) {
    return {
      changed: true,
      content: `${sourceText.slice(0, insertionIndex)}\n${normalizedImportLine}${sourceText.slice(insertionIndex)}`
    };
  }

  return {
    changed: true,
    content: `${normalizedImportLine}\n${sourceText}`
  };
}

function insertBeforeClassDeclaration(source = "", line = "", { className = "", contextFile = "" } = {}) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return {
      changed: false,
      content: String(source || "")
    };
  }

  const sourceText = String(source || "");
  if (sourceText.includes(normalizedLine)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const normalizedClassName = String(className || "").trim();
  const classPattern = new RegExp(`^class\\s+${normalizedClassName}\\b`, "m");
  const classMatch = classPattern.exec(sourceText);
  if (!classMatch) {
    const targetFile = String(contextFile || "").trim() || "target file";
    throw new Error(`ui-generator could not find ${normalizedClassName} class declaration in ${targetFile}.`);
  }

  const insertionIndex = classMatch.index;
  return {
    changed: true,
    content: `${sourceText.slice(0, insertionIndex)}${normalizedLine}\n\n${sourceText.slice(insertionIndex)}`
  };
}

function findScriptBlock(source = "") {
  const sourceText = String(source || "");
  let firstMatch = null;

  for (const match of sourceText.matchAll(SCRIPT_TAG_PATTERN)) {
    if (!firstMatch) {
      firstMatch = match;
    }

    const attributesSource = String(match[1] || "");
    if (SCRIPT_SETUP_ATTRIBUTE_PATTERN.test(attributesSource)) {
      return Object.freeze({
        index: match.index,
        source: String(match[0] || ""),
        attributesSource,
        content: String(match[2] || "")
      });
    }
  }

  if (!firstMatch) {
    return null;
  }

  return Object.freeze({
    index: firstMatch.index,
    source: String(firstMatch[0] || ""),
    attributesSource: String(firstMatch[1] || ""),
    content: String(firstMatch[2] || "")
  });
}

function parseTagAttributes(attributesSource = "") {
  const attributes = {};
  const source = String(attributesSource || "");
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const attributeName = normalizeText(match[1]);
    if (!attributeName) {
      continue;
    }
    const hasValue = match[2] != null || match[3] != null;
    attributes[attributeName] = hasValue ? String(match[2] ?? match[3] ?? "") : true;
  }
  return attributes;
}

function indentBlock(source = "", indent = "") {
  const sourceText = String(source || "");
  const indentation = String(indent || "");
  return sourceText
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

export {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  PLACEMENT_FILE,
  toKebabCase,
  toPascalCase,
  requireOption,
  requireSinglePositionalTargetFile,
  resolveOutletTargetId,
  rejectUnexpectedOptions,
  resolvePathWithinApp,
  ensureTrailingNewline,
  appendBlockIfMarkerMissing,
  insertImportIfMissing,
  insertBeforeClassDeclaration,
  findScriptBlock,
  parseTagAttributes,
  indentBlock
};
