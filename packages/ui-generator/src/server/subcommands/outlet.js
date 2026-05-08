import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizePlacementOwnerId,
  normalizePlacementSurfaceId,
  normalizeSemanticPlacementId
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
import {
  PLACEMENT_TOPOLOGY_FILE,
  appendBlockIfMarkerMissing,
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

const ROUTE_TAG_PATTERN = /<route\b[^>]*>[\s\S]*?<\/route>\s*/gi;
const TEMPLATE_CLOSE_TAG_PATTERN = /<\/template>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b([^>]*)\/?>/gi;

function hasShellOutletTarget(source = "", { target = "" } = {}) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return false;
  }

  const sourceText = String(source || "");
  for (const match of sourceText.matchAll(SHELL_OUTLET_TAG_PATTERN)) {
    const attributes = parseTagAttributes(match[1]);
    const outletTarget = normalizeText(attributes.target);
    if (outletTarget === normalizedTarget) {
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

function createOutletBlock({ target = "" } = {}) {
  return `<ShellOutlet target="${target}" />`;
}

function resolveOutletOwner(target = "") {
  const normalizedTarget = normalizeText(target);
  const separatorIndex = normalizedTarget.indexOf(":");
  if (separatorIndex <= 0) {
    return "";
  }
  return normalizedTarget.slice(0, separatorIndex);
}

function resolveSemanticPlacementOption(options = {}) {
  const placementId = normalizeSemanticPlacementId(options?.placement);
  if (!placementId) {
    throw new Error('ui-generator outlet requires --placement in semantic "area.slot" format.');
  }
  return placementId;
}

function resolveSemanticPlacementOwner({ placementId = "", targetId = "", owner = "" } = {}) {
  const explicitOwner = normalizePlacementOwnerId(owner);
  if (explicitOwner) {
    return explicitOwner;
  }
  if (placementId.startsWith("page.") || placementId.startsWith("settings.")) {
    return resolveOutletOwner(targetId);
  }
  return "";
}

function resolveTopologySurfaces(options = {}) {
  const surface = normalizePlacementSurfaceId(options?.surface);
  if (surface) {
    return [surface];
  }
  return ["*"];
}

function renderTopologyOwnerLine(owner = "") {
  if (!owner) {
    return "";
  }
  return `  owner: "${owner}",\n`;
}

function renderLinkRendererBlock(rendererToken = "") {
  const normalizedRendererToken = normalizeText(rendererToken) || "local.main.ui.surface-aware-menu-link-item";
  return (
    "      renderers: {\n" +
    `        link: "${normalizedRendererToken}"\n` +
    "      }\n"
  );
}

function renderOutletTopologyBlock({
  marker = "",
  placementId = "",
  owner = "",
  surfaces = ["*"],
  description = "",
  target = "",
  rendererToken = ""
} = {}) {
  const descriptionLine = normalizeText(description)
    ? `  description: ${JSON.stringify(normalizeText(description))},\n`
    : "";
  const rendererBlock = renderLinkRendererBlock(rendererToken);
  return (
    `// ${marker}\n` +
    "addPlacementTopology({\n" +
    `  id: "${placementId}",\n` +
    renderTopologyOwnerLine(owner) +
    descriptionLine +
    `  surfaces: ${JSON.stringify(surfaces)},\n` +
    "  variants: {\n" +
    "    compact: {\n" +
    `      outlet: "${target}",\n` +
    rendererBlock +
    "    },\n" +
    "    medium: {\n" +
    `      outlet: "${target}",\n` +
    rendererBlock +
    "    },\n" +
    "    expanded: {\n" +
    `      outlet: "${target}",\n` +
    rendererBlock +
    "    }\n" +
    "  }\n" +
    "});\n"
  );
}

function findLastTemplateCloseTag(source = "") {
  const sourceText = String(source || "");
  let lastMatch = null;
  for (const match of sourceText.matchAll(TEMPLATE_CLOSE_TAG_PATTERN)) {
    lastMatch = match;
  }
  return lastMatch;
}

function applyOutletTemplateBlock(source = "", { target = "" } = {}) {
  const sourceText = String(source || "");
  const outletBlock = createOutletBlock({ target });

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
  rejectUnexpectedOptions(options, ["target", "placement", "owner", "surface", "description", "link-renderer"], {
    context: "ui-generator outlet"
  });

  const outletTarget = resolveOutletTargetId(options?.target, {
    context: "ui-generator outlet",
    optionName: "target"
  });
  const targetId = outletTarget.id;
  const placementId = resolveSemanticPlacementOption(options);
  const owner = resolveSemanticPlacementOwner({
    placementId,
    targetId,
    owner: options?.owner
  });
  const surfaces = resolveTopologySurfaces(options);

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

  const hasTargetOutlet = hasShellOutletTarget(source, { target: targetId });
  const templateApplied = hasTargetOutlet
    ? { changed: false, content: source }
    : applyOutletTemplateBlock(source, {
      target: targetId
    });
  const scriptApplied = applyScriptImports(templateApplied.content);

  const changed = templateApplied.changed || scriptApplied.changed;
  if (changed && dryRun !== true) {
    await writeFile(targetFilePath.absolutePath, scriptApplied.content, "utf8");
  }

  const topologyPath = resolvePathWithinApp(appRoot, PLACEMENT_TOPOLOGY_FILE, {
    context: "ui-generator outlet"
  });
  const topologyMarker = `jskit:ui-generator.topology:${placementId}:${owner || "global"}`;
  const topologySource = await readFile(topologyPath.absolutePath, "utf8");
  const topologyApplied = appendBlockIfMarkerMissing(
    topologySource,
    topologyMarker,
    renderOutletTopologyBlock({
      marker: topologyMarker,
      placementId,
      owner,
      surfaces,
      description: options?.description,
      target: targetId,
      rendererToken: options?.["link-renderer"]
    })
  );
  if (topologyApplied.changed && dryRun !== true) {
    await writeFile(topologyPath.absolutePath, topologyApplied.content, "utf8");
  }

  const touchedFiles = new Set();
  if (changed) {
    touchedFiles.add(targetFilePath.relativePath);
  }
  if (topologyApplied.changed) {
    touchedFiles.add(topologyPath.relativePath);
  }

  return {
    touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
    summary: touchedFiles.size > 0
      ? `Injected outlet "${targetId}" and mapped semantic placement "${placementId}"${owner ? ` for owner "${owner}"` : ""}.`
      : `Outlet "${targetId}" and semantic placement "${placementId}" are already present.`
  };
}

export { runGeneratorSubcommand };
