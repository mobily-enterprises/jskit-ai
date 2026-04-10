import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions,
  resolveOutletTargetId,
  resolvePathWithinApp,
  ensureTrailingNewline,
  insertImportIfMissing,
  findScriptBlock,
  parseTagAttributes,
  indentBlock
} from "./support.js";

const DEFAULT_OUTLET_POSITION = "sub-pages";

const ROUTE_TAG_PATTERN = /<route\b[^>]*>[\s\S]*?<\/route>\s*/gi;
const TEMPLATE_CLOSE_TAG_PATTERN = /<\/template>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b([^>]*)\/?>/gi;

function hasShellOutletTarget(source = "", { host = "", position = "" } = {}) {
  const normalizedHost = normalizeText(host);
  const normalizedPosition = normalizeText(position);
  if (!normalizedHost || !normalizedPosition) {
    return false;
  }

  const sourceText = String(source || "");
  for (const match of sourceText.matchAll(SHELL_OUTLET_TAG_PATTERN)) {
    const attributes = parseTagAttributes(match[1]);
    const outletHost = normalizeText(attributes.host);
    const outletPosition = normalizeText(attributes.position);
    if (outletHost === normalizedHost && outletPosition === normalizedPosition) {
      return true;
    }
  }
  return false;
}

function applyScriptImports(source = "") {
  const sourceText = String(source || "");
  const scriptBlock = findScriptBlock(sourceText);

  const shellOutletImport = "import ShellOutlet from \"@jskit-ai/shell-web/client/components/ShellOutlet\";";

  if (!scriptBlock) {
    const scriptSetupBlock = `<script setup>\n${shellOutletImport}\n</script>\n`;
    let insertionIndex = 0;
    for (const match of sourceText.matchAll(ROUTE_TAG_PATTERN)) {
      insertionIndex = match.index + String(match[0] || "").length;
    }
    const separator = insertionIndex > 0 ? "\n" : "";
    return {
      changed: true,
      content: `${sourceText.slice(0, insertionIndex)}${separator}${scriptSetupBlock}\n${sourceText.slice(insertionIndex)}`
    };
  }

  let nextScriptContent = scriptBlock.content;
  const shellImportApplied = insertImportIfMissing(nextScriptContent, shellOutletImport);
  nextScriptContent = shellImportApplied.content;
  if (!shellImportApplied.changed) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const nextScriptTag = `<script${scriptBlock.attributesSource}>${nextScriptContent}</script>`;
  const replacementContent =
    `${sourceText.slice(0, scriptBlock.index)}${nextScriptTag}${sourceText.slice(scriptBlock.index + scriptBlock.source.length)}`;
  return {
    changed: true,
    content: replacementContent
  };
}

function createOutletBlock({ host = "", position = "" } = {}) {
  return `<ShellOutlet host=\"${host}\" position=\"${position}\" />`;
}

function findLastTemplateCloseTag(source = "") {
  const sourceText = String(source || "");
  let lastMatch = null;
  for (const match of sourceText.matchAll(TEMPLATE_CLOSE_TAG_PATTERN)) {
    lastMatch = match;
  }
  return lastMatch;
}

function applyOutletTemplateBlock(source = "", { host = "", position = "" } = {}) {
  const sourceText = String(source || "");
  const outletBlock = createOutletBlock({ host, position });

  const templateTagMatch = findLastTemplateCloseTag(sourceText);
  if (!templateTagMatch) {
    const nextContent = `${ensureTrailingNewline(sourceText)}\n<template>\n${indentBlock(outletBlock, "  ")}\n</template>\n`;
    return {
      changed: true,
      content: nextContent
    };
  }

  const insertionIndex = templateTagMatch.index;
  const templateCloseLineStart = sourceText.lastIndexOf("\n", insertionIndex - 1) + 1;
  const closingIndent = sourceText.slice(templateCloseLineStart, insertionIndex);
  const childIndent = `${closingIndent}  `;
  const beforeTemplateClose = sourceText.slice(0, templateCloseLineStart);
  const afterTemplateClose = sourceText.slice(templateCloseLineStart);
  const separator = beforeTemplateClose.endsWith("\n") || beforeTemplateClose.length < 1 ? "" : "\n";
  const nextContent = `${beforeTemplateClose}${separator}${indentBlock(outletBlock, childIndent)}\n${afterTemplateClose}`;
  return {
    changed: true,
    content: nextContent
  };
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "outlet") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator outlet" });
  rejectUnexpectedOptions(options, ["target"], {
    context: "ui-generator outlet"
  });

  const outletTarget = resolveOutletTargetId(options?.target, {
    context: "ui-generator outlet",
    optionName: "target",
    defaultPosition: DEFAULT_OUTLET_POSITION
  });
  const { host, position } = outletTarget;

  const targetFilePath = resolvePathWithinApp(appRoot, targetFile, {
    context: "ui-generator outlet"
  });
  if (!targetFilePath.relativePath.toLowerCase().endsWith(".vue")) {
    throw new Error(
      `ui-generator outlet target file must be an existing Vue SFC (.vue): ${targetFilePath.relativePath}.`
    );
  }

  let source = "";
  try {
    source = await readFile(targetFilePath.absolutePath, "utf8");
  } catch {
    throw new Error(`ui-generator outlet target file not found: ${targetFilePath.relativePath}.`);
  }

  const hasTargetOutlet = hasShellOutletTarget(source, { host, position });
  const templateApplied = hasTargetOutlet
    ? { changed: false, content: source }
    : applyOutletTemplateBlock(source, {
      host,
      position
    });
  const scriptApplied = applyScriptImports(templateApplied.content);

  const changed = templateApplied.changed || scriptApplied.changed;
  if (changed && dryRun !== true) {
    await writeFile(targetFilePath.absolutePath, scriptApplied.content, "utf8");
  }

  return {
    touchedFiles: changed ? [targetFilePath.relativePath] : [],
    summary: changed
      ? `Injected outlet \"${host}:${position}\" into ${targetFilePath.relativePath}.`
      : `Outlet \"${host}:${position}\" is already present in ${targetFilePath.relativePath}.`
  };
}

export { runGeneratorSubcommand };
