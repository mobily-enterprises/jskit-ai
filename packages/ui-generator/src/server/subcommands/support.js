import path from "node:path";
import {
  resolveRequiredAppRoot,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toCamelCase, toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_COMPONENT_DIRECTORY = "src/components";
const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const PLACEMENT_FILE = "src/placement.js";

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

export {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  PLACEMENT_FILE,
  toKebabCase,
  toPascalCase,
  requireOption,
  resolvePathWithinApp,
  ensureTrailingNewline,
  appendBlockIfMarkerMissing,
  insertImportIfMissing,
  insertBeforeClassDeclaration
};
