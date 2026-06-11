import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizePlacementOwnerId,
  normalizePlacementSurfaceId,
  normalizeSemanticPlacementId
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
import {
  PLACEMENT_TOPOLOGY_FILE,
  appendTopologyBlockIfPlacementMissing,
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions,
  resolveOutletTargetId,
  resolvePathWithinApp,
  ensureTrailingNewline,
  insertImportIfMissing,
  findScriptSetupBlock,
  insertScriptSetupBlock,
  parseTagAttributes,
  indentBlock
} from "./support.js";

const TEMPLATE_CLOSE_TAG_PATTERN = /<\/template>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b([^>]*)\/?>/gi;
const TOPOLOGY_LAYOUT_CLASSES = Object.freeze(["compact", "medium", "expanded"]);
const TOPOLOGY_KINDS = new Set(["component", "link"]);

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
  const scriptBlock = findScriptSetupBlock(sourceText);

  const shellOutletImport = "import ShellOutlet from \"@jskit-ai/shell-web/client/components/ShellOutlet\";";

  if (!scriptBlock) {
    return insertScriptSetupBlock(sourceText, shellOutletImport);
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

function resolveSemanticPlacementOption(options = {}, { context = "ui-generator outlet" } = {}) {
  const placementId = resolveOptionalSemanticPlacementOption(options, { context });
  if (!placementId) {
    throw new Error(`${context} requires --placement in semantic "area.slot" format.`);
  }
  return placementId;
}

function resolveOptionalSemanticPlacementOption(options = {}, { context = "ui-generator outlet" } = {}) {
  const rawPlacement = normalizeText(options?.placement);
  if (!rawPlacement) {
    return "";
  }
  const placementId = normalizeSemanticPlacementId(rawPlacement);
  if (!placementId) {
    throw new Error(`${context} requires --placement in semantic "area.slot" format.`);
  }
  return placementId;
}

function resolveVariantOwners(variantTargets = {}) {
  return [
    ...new Set(
      Object.values(variantTargets || {})
        .map((target) => resolveOutletOwner(target))
        .filter(Boolean)
    )
  ];
}

function resolveSemanticPlacementOwner({
  placementId = "",
  targetId = "",
  variantTargets = null,
  owner = "",
  context = "ui-generator outlet"
} = {}) {
  const explicitOwner = normalizePlacementOwnerId(owner);
  if (explicitOwner) {
    return explicitOwner;
  }
  if (placementId.startsWith("page.") || placementId.startsWith("settings.")) {
    const variantOwners = resolveVariantOwners(variantTargets);
    if (variantOwners.length > 1) {
      throw new Error(
        `${context} requires --owner because semantic placement "${placementId}" maps to multiple outlet hosts: ${variantOwners.join(", ")}.`
      );
    }
    if (variantOwners.length === 1) {
      return variantOwners[0];
    }
    return resolveOutletOwner(targetId);
  }
  return "";
}

function resolveTopologyKind(options = {}, { context = "ui-generator outlet", defaultKind = "", required = false } = {}) {
  const rawKind = normalizeText(options?.kind).toLowerCase();
  if (!rawKind) {
    if (defaultKind) {
      return defaultKind;
    }
    if (required) {
      throw new Error(`${context} requires --kind component or --kind link.`);
    }
    return "";
  }
  if (!TOPOLOGY_KINDS.has(rawKind)) {
    throw new Error(`${context} option "kind" must be one of: component, link.`);
  }
  return rawKind;
}

function resolveTopologyVariantTargets(options = {}, { context = "ui-generator topology", fallbackTarget = "" } = {}) {
  const fallback = normalizeText(options?.target) || normalizeText(fallbackTarget);
  const rawTargets = {
    compact: normalizeText(options?.["compact-target"]) || fallback,
    medium: normalizeText(options?.["medium-target"]) || fallback,
    expanded: normalizeText(options?.["expanded-target"]) || fallback
  };
  const missingLayouts = TOPOLOGY_LAYOUT_CLASSES.filter((layoutClass) => !rawTargets[layoutClass]);
  if (missingLayouts.length > 0) {
    throw new Error(
      `${context} requires --target or all layout targets: --compact-target, --medium-target, --expanded-target. Missing: ${missingLayouts.join(", ")}.`
    );
  }

  return Object.freeze(
    Object.fromEntries(
      TOPOLOGY_LAYOUT_CLASSES.map((layoutClass) => {
        const target = resolveOutletTargetId(rawTargets[layoutClass], {
          context,
          optionName: `${layoutClass}-target`
        });
        return [layoutClass, target.id];
      })
    )
  );
}

function hasTopologyOptions(options = {}) {
  return [
    "compact-target",
    "medium-target",
    "expanded-target",
    "owner",
    "surface",
    "description",
    "kind",
    "link-renderer"
  ].some((optionName) => normalizeText(options?.[optionName]));
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

function renderTopologyVariantBlock({ layoutClass = "", target = "", kind = "", rendererToken = "" } = {}) {
  const rendererBlock = kind === "link" ? renderLinkRendererBlock(rendererToken) : "";
  const outletSeparator = rendererBlock ? "," : "";
  return (
    `    ${layoutClass}: {\n` +
    `      outlet: "${target}"${outletSeparator}\n` +
    rendererBlock +
    "    }"
  );
}

function renderOutletTopologyBlock({
  marker = "",
  placementId = "",
  owner = "",
  surfaces = ["*"],
  description = "",
  target = "",
  variantTargets = null,
  kind = "link",
  rendererToken = ""
} = {}) {
  const descriptionLine = normalizeText(description)
    ? `  description: ${JSON.stringify(normalizeText(description))},\n`
    : "";
  const resolvedVariantTargets = variantTargets || Object.freeze({
    compact: target,
    medium: target,
    expanded: target
  });
  const variantBlocks = TOPOLOGY_LAYOUT_CLASSES
    .map((layoutClass) => renderTopologyVariantBlock({
      layoutClass,
      target: resolvedVariantTargets[layoutClass],
      kind,
      rendererToken
    }))
    .join(",\n");
  return (
    `// ${marker}\n` +
    "addPlacementTopology({\n" +
    `  id: "${placementId}",\n` +
    renderTopologyOwnerLine(owner) +
    descriptionLine +
    `  surfaces: ${JSON.stringify(surfaces)},\n` +
    "  variants: {\n" +
    `${variantBlocks}\n` +
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
  if (normalizedSubcommand === "topology") {
    return runTopologySubcommand({
      appRoot,
      options,
      dryRun
    });
  }
  if (normalizedSubcommand !== "outlet") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator outlet" });
  rejectUnexpectedOptions(
    options,
    [
      "target",
      "placement",
      "owner",
      "surface",
      "description",
      "link-renderer",
      "kind",
      "compact-target",
      "medium-target",
      "expanded-target"
    ],
    { context: "ui-generator outlet" }
  );

  const outletTarget = resolveOutletTargetId(options?.target, {
    context: "ui-generator outlet",
    optionName: "target"
  });
  const targetId = outletTarget.id;
  const placementId = resolveOptionalSemanticPlacementOption(options);
  if (!placementId && hasTopologyOptions(options)) {
    throw new Error("ui-generator outlet requires --placement when topology options are provided.");
  }

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

  const topologyPath = resolvePathWithinApp(appRoot, PLACEMENT_TOPOLOGY_FILE, {
    context: "ui-generator outlet"
  });
  const topologyApplied = placementId
    ? await prepareTopologyBlock({
      appRoot,
      topologyPath,
      context: "ui-generator outlet",
      placementId,
      owner: options?.owner,
      surfaces: resolveTopologySurfaces(options),
      description: options?.description,
      target: targetId,
      variantTargets: resolveTopologyVariantTargets(options, {
        context: "ui-generator outlet",
        fallbackTarget: targetId
      }),
      kind: resolveTopologyKind(options, {
        context: "ui-generator outlet",
        defaultKind: "link"
      }),
      rendererToken: options?.["link-renderer"]
    })
    : { changed: false, relativePath: topologyPath.relativePath };

  const changed = templateApplied.changed || scriptApplied.changed;
  if (changed && dryRun !== true) {
    await writeFile(targetFilePath.absolutePath, scriptApplied.content, "utf8");
  }
  if (topologyApplied.changed && dryRun !== true) {
    await writeFile(topologyApplied.absolutePath, topologyApplied.content, "utf8");
  }

  const touchedFiles = new Set();
  if (changed) {
    touchedFiles.add(targetFilePath.relativePath);
  }
  if (topologyApplied.changed) {
    touchedFiles.add(topologyApplied.relativePath);
  }

  const actionSummary = [
    changed ? `Injected outlet "${targetId}"` : "",
    topologyApplied.changed && placementId
      ? `mapped semantic placement "${placementId}"`
      : ""
  ].filter(Boolean).join(" and ");
  return {
    touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
    summary: touchedFiles.size > 0
      ? `${actionSummary || `Processed outlet "${targetId}"`}.`
      : placementId
        ? `Outlet "${targetId}" and semantic placement "${placementId}" are already present.`
        : `Outlet "${targetId}" is already present.`
  };
}

async function prepareTopologyBlock({
  appRoot,
  topologyPath = null,
  context = "ui-generator topology",
  placementId = "",
  owner = "",
  surfaces = ["*"],
  description = "",
  target = "",
  variantTargets = null,
  kind = "",
  rendererToken = ""
} = {}) {
  const resolvedTopologyPath = topologyPath || resolvePathWithinApp(appRoot, PLACEMENT_TOPOLOGY_FILE, {
    context
  });
  const resolvedOwner = resolveSemanticPlacementOwner({
    placementId,
    targetId: target,
    variantTargets,
    owner,
    context
  });
  const topologyMarker = `jskit:ui-generator.topology:${placementId}:${resolvedOwner || "global"}`;
  const topologySource = await readFile(resolvedTopologyPath.absolutePath, "utf8");
  const topologyApplied = await appendTopologyBlockIfPlacementMissing({
    topologyPath: resolvedTopologyPath,
    source: topologySource,
    marker: topologyMarker,
    block: renderOutletTopologyBlock({
      marker: topologyMarker,
      placementId,
      owner: resolvedOwner,
      surfaces,
      description,
      target,
      variantTargets,
      kind,
      rendererToken
    }),
    placementId,
    owner: resolvedOwner,
    variantTargets,
    context
  });
  return {
    changed: topologyApplied.changed,
    content: topologyApplied.content,
    absolutePath: resolvedTopologyPath.absolutePath,
    relativePath: resolvedTopologyPath.relativePath,
    owner: resolvedOwner
  };
}

async function applyTopologyBlock(options = {}) {
  const topologyApplied = await prepareTopologyBlock(options);
  if (topologyApplied.changed && options?.dryRun !== true) {
    await writeFile(topologyApplied.absolutePath, topologyApplied.content, "utf8");
  }
  return {
    changed: topologyApplied.changed,
    relativePath: topologyApplied.relativePath,
    owner: topologyApplied.owner
  };
}

async function runTopologySubcommand({
  appRoot,
  options = {},
  dryRun = false
} = {}) {
  const context = "ui-generator topology";
  rejectUnexpectedOptions(
    options,
    [
      "target",
      "compact-target",
      "medium-target",
      "expanded-target",
      "placement",
      "owner",
      "surface",
      "description",
      "kind",
      "link-renderer"
    ],
    { context }
  );
  const placementId = resolveSemanticPlacementOption(options, { context });
  const variantTargets = resolveTopologyVariantTargets(options, { context });
  const kind = resolveTopologyKind(options, { context, required: true });
  const topologyApplied = await applyTopologyBlock({
    appRoot,
    context,
    placementId,
    owner: options?.owner,
    surfaces: resolveTopologySurfaces(options),
    description: options?.description,
    target: variantTargets.compact,
    variantTargets,
    kind,
    rendererToken: options?.["link-renderer"],
    dryRun
  });

  return {
    touchedFiles: topologyApplied.changed ? [topologyApplied.relativePath] : [],
    summary: topologyApplied.changed
      ? `Mapped semantic placement "${placementId}"${topologyApplied.owner ? ` for owner "${topologyApplied.owner}"` : ""}.`
      : `Semantic placement "${placementId}"${topologyApplied.owner ? ` for owner "${topologyApplied.owner}"` : ""} is already present.`
  };
}

export { runGeneratorSubcommand };
