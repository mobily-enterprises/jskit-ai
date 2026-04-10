import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeBoolean, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  readAssistantPageTemplateSource,
  renderAssistantPageLinkPlacementBlock,
  renderAssistantPageSource,
  renderAssistantPageSummary,
  resolveAssistantPageGenerationContext
} from "../pageSupport.js";
import { loadAppConfig, resolveSurfaceDefinition } from "../support.js";
import {
  PLACEMENT_FILE,
  appendBlockIfMarkerMissing,
  rejectUnexpectedOptions,
  requireEmptyPageSource,
  requireSinglePositionalTargetFile,
  resolvePathWithinApp
} from "./support.js";

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "settings-page") {
    throw new Error(`Unsupported assistant subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }

  const targetFile = requireSinglePositionalTargetFile(args, { context: "assistant settings-page" });
  rejectUnexpectedOptions(options, ["surface", "name", "link-placement", "link-component-token", "link-to", "force"], {
    context: "assistant settings-page"
  });
  const forceOverwrite = Object.prototype.hasOwnProperty.call(options, "force")
    ? normalizeBoolean(options.force)
    : false;

  const appConfig = await loadAppConfig(appRoot);
  const targetSurface = resolveSurfaceDefinition(appConfig, options?.surface, "surface");
  const generationContext = await resolveAssistantPageGenerationContext({
    appRoot,
    targetFile,
    options,
    context: "assistant settings-page"
  });
  const pageTarget = generationContext.pageTarget;
  const pageFilePath = pageTarget.targetFilePath.absolutePath;
  const pageRelativePath = pageTarget.targetFilePath.relativePath;
  const templateSource = await readAssistantPageTemplateSource("settings-page");
  const desiredPageSource = renderAssistantPageSource(templateSource, targetSurface.id);

  let existingPageSource = "";
  let pageAlreadyExisted = true;
  try {
    existingPageSource = await readFile(pageFilePath, "utf8");
  } catch {
    pageAlreadyExisted = false;
  }

  requireEmptyPageSource(existingPageSource, pageRelativePath, {
    context: "assistant settings-page",
    forceOverwrite
  });

  const touchedFiles = new Set();
  if (!pageAlreadyExisted || forceOverwrite) {
    if (dryRun !== true) {
      await mkdir(path.dirname(pageFilePath), { recursive: true });
      await writeFile(pageFilePath, desiredPageSource, "utf8");
    }
    touchedFiles.add(pageRelativePath);
  }

  const placementPath = resolvePathWithinApp(pageTarget.appRoot, PLACEMENT_FILE, {
    context: "assistant settings-page"
  });
  const placementSource = await readFile(placementPath.absolutePath, "utf8");
  const placementMarker =
    `jskit:assistant.settings-page.link:${pageTarget.surfaceId}:${pageTarget.routeUrlSuffix}:${targetSurface.id}`;
  const placementApplied = appendBlockIfMarkerMissing(
    placementSource,
    placementMarker,
    renderAssistantPageLinkPlacementBlock({
      marker: placementMarker,
      pageTarget,
      generationContext
    })
  );
  if (placementApplied.changed) {
    if (dryRun !== true) {
      await writeFile(placementPath.absolutePath, placementApplied.content, "utf8");
    }
    touchedFiles.add(placementPath.relativePath);
  }

  return {
    touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
    summary: renderAssistantPageSummary(pageTarget, {
      pageAlreadyExisted,
      pageOverwritten: pageAlreadyExisted && forceOverwrite,
      placementChanged: placementApplied.changed
    })
  };
}

export { runGeneratorSubcommand };
