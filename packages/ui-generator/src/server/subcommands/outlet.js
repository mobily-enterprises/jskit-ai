import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  requireOption,
  resolvePathWithinApp,
  ensureTrailingNewline,
  insertImportIfMissing
} from "./support.js";

const DEFAULT_OUTLET_POSITION = "sub-pages";
const MODE_ROUTED = "routed";
const MODE_OUTLET_ONLY = "outlet-only";

const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ROUTE_TAG_PATTERN = /<route\b[^>]*>[\s\S]*?<\/route>\s*/gi;
const TEMPLATE_CLOSE_TAG_PATTERN = /<\/template>/gi;
const ROUTER_VIEW_TAG_PATTERN = /<RouterView(?:\s|\/|>)/;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b([^>]*)\/?>/gi;
const ATTRIBUTE_PATTERN = /([:@]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
const SCRIPT_SETUP_ATTRIBUTE_PATTERN = /\bsetup\b/i;

function resolveOutletMode(rawMode = "") {
  const normalized = String(rawMode || "").trim().toLowerCase();
  if (!normalized || normalized === MODE_ROUTED) {
    return MODE_ROUTED;
  }
  if (normalized === MODE_OUTLET_ONLY || normalized === "outlet") {
    return MODE_OUTLET_ONLY;
  }

  throw new Error(`ui-generator outlet received unsupported --mode value: ${rawMode}. Use routed or outlet-only.`);
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

function hasImportFromModule(source = "", modulePath = "") {
  const normalizedModulePath = String(modulePath || "").trim();
  if (!normalizedModulePath) {
    return false;
  }

  const sourceText = String(source || "");
  return sourceText.includes(`from "${normalizedModulePath}"`) || sourceText.includes(`from '${normalizedModulePath}'`);
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

function applyScriptImports(source = "", { includeRouterViewImport = false } = {}) {
  const sourceText = String(source || "");
  const scriptBlock = findScriptBlock(sourceText);

  const shellOutletImport = "import ShellOutlet from \"@jskit-ai/shell-web/client/components/ShellOutlet\";";
  const routerViewImport = "import { RouterView } from \"vue-router\";";

  if (!scriptBlock) {
    const importLines = [shellOutletImport];
    if (includeRouterViewImport) {
      importLines.push(routerViewImport);
    }
    const scriptSetupBlock = `<script setup>\n${importLines.join("\n")}\n</script>\n`;
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

  let routerImportChanged = false;
  if (includeRouterViewImport && !hasImportFromModule(nextScriptContent, "vue-router")) {
    const routerImportApplied = insertImportIfMissing(nextScriptContent, routerViewImport);
    nextScriptContent = routerImportApplied.content;
    routerImportChanged = routerImportApplied.changed;
  }

  if (!shellImportApplied.changed && !routerImportChanged) {
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

function createOutletBlock({ host = "", position = "", includeRouterView = false } = {}) {
  const lines = [
    `<ShellOutlet host=\"${host}\" position=\"${position}\" />`
  ];
  if (includeRouterView) {
    lines.push("<RouterView />");
  }
  return lines.join("\n");
}

function indentBlock(source = "", indent = "") {
  const sourceText = String(source || "");
  const indentation = String(indent || "");
  return sourceText
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function findLastTemplateCloseTag(source = "") {
  const sourceText = String(source || "");
  let lastMatch = null;
  for (const match of sourceText.matchAll(TEMPLATE_CLOSE_TAG_PATTERN)) {
    lastMatch = match;
  }
  return lastMatch;
}

function applyOutletTemplateBlock(source = "", { host = "", position = "", includeRouterView = false } = {}) {
  const sourceText = String(source || "");
  const outletBlock = createOutletBlock({ host, position, includeRouterView });

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
  if (Array.isArray(args) && args.length > 0) {
    throw new Error("ui-generator outlet does not accept positional arguments.");
  }

  const targetFile = requireOption(options, "file", { context: "ui-generator outlet" });
  const host = requireOption(options, "host", { context: "ui-generator outlet" });
  const position = normalizeText(options?.position) || DEFAULT_OUTLET_POSITION;
  const mode = resolveOutletMode(options?.mode);

  const targetFilePath = resolvePathWithinApp(appRoot, targetFile, {
    context: "ui-generator outlet"
  });

  let source = "";
  try {
    source = await readFile(targetFilePath.absolutePath, "utf8");
  } catch {
    throw new Error(`ui-generator outlet target file not found: ${targetFilePath.relativePath}.`);
  }

  const hasTargetOutlet = hasShellOutletTarget(source, { host, position });
  const hasRouterView = ROUTER_VIEW_TAG_PATTERN.test(source);
  const shouldInsertRouterView = mode === MODE_ROUTED && !hasRouterView && !hasTargetOutlet;

  const templateApplied = hasTargetOutlet
    ? { changed: false, content: source }
    : applyOutletTemplateBlock(source, {
      host,
      position,
      includeRouterView: shouldInsertRouterView
    });
  const scriptApplied = applyScriptImports(templateApplied.content, {
    includeRouterViewImport: shouldInsertRouterView
  });

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
