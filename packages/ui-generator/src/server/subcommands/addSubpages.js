import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  DEFAULT_SUBPAGES_POSITION,
  SUBPAGES_LINK_COMPONENT_TOKEN,
  deriveDefaultSubpagesHost,
  resolvePageTargetDetails,
  upgradePageFileToSubpages
} from "./pageSupport.js";
import {
  PLACEMENT_TOPOLOGY_FILE,
  appendTopologyBlockIfPlacementMissing,
  requireSinglePositionalTargetFile,
  resolvePathWithinApp,
  resolveOutletTargetId,
  rejectUnexpectedOptions
} from "./support.js";

function resolveOutletOwner(target = "") {
  const normalizedTarget = normalizeText(target);
  const separatorIndex = normalizedTarget.indexOf(":");
  if (separatorIndex <= 0) {
    return "";
  }
  return normalizedTarget.slice(0, separatorIndex);
}

function renderSectionNavTopologyBlock({
  marker = "",
  owner = "",
  surface = "",
  target = ""
} = {}) {
  return (
    `// ${marker}\n` +
    "addPlacementTopology({\n" +
    `  id: "page.section-nav",\n` +
    `  owner: "${owner}",\n` +
    `  description: "Navigation between child pages in this section.",\n` +
    `  surfaces: ["${surface}"],\n` +
    "  variants: {\n" +
    "    compact: {\n" +
    `      outlet: "${target}",\n` +
    "      renderers: {\n" +
    `        link: "${SUBPAGES_LINK_COMPONENT_TOKEN}"\n` +
    "      }\n" +
    "    },\n" +
    "    medium: {\n" +
    `      outlet: "${target}",\n` +
    "      renderers: {\n" +
    `        link: "${SUBPAGES_LINK_COMPONENT_TOKEN}"\n` +
    "      }\n" +
    "    },\n" +
    "    expanded: {\n" +
    `      outlet: "${target}",\n` +
    "      renderers: {\n" +
    `        link: "${SUBPAGES_LINK_COMPONENT_TOKEN}"\n` +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "});\n"
  );
}

function resolveSubpagesOutletTarget(options = {}, pageTarget = {}) {
  const rawTarget = normalizeText(options?.target);
  const defaultTarget = `${deriveDefaultSubpagesHost(pageTarget)}:${DEFAULT_SUBPAGES_POSITION}`;
  return resolveOutletTargetId(rawTarget || defaultTarget, {
    context: "ui-generator add-subpages",
    optionName: "target"
  });
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "add-subpages") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator add-subpages" });
  rejectUnexpectedOptions(
    options,
    ["target", "path", "title", "subtitle"],
    { context: "ui-generator add-subpages" }
  );

  const componentDirectory = normalizeText(options?.path) || DEFAULT_COMPONENT_DIRECTORY;
  const title = normalizeText(options?.title);
  const subtitle = normalizeText(options?.subtitle);
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator add-subpages"
  });
  const outletTarget = resolveSubpagesOutletTarget(options, pageTarget);

  const topologyPath = resolvePathWithinApp(appRoot, PLACEMENT_TOPOLOGY_FILE, {
    context: "ui-generator add-subpages"
  });
  const owner = resolveOutletOwner(outletTarget.id);
  const topologyMarker = `jskit:ui-generator.topology:page.section-nav:${owner}`;
  const topologySource = await readFile(topologyPath.absolutePath, "utf8");
  const expectedVariantTargets = {
    compact: outletTarget.id,
    medium: outletTarget.id,
    expanded: outletTarget.id
  };
  const topologyApplied = await appendTopologyBlockIfPlacementMissing({
    topologyPath,
    source: topologySource,
    marker: topologyMarker,
    block: renderSectionNavTopologyBlock({
      marker: topologyMarker,
      owner,
      surface: pageTarget.surfaceId,
      target: outletTarget.id
    }),
    placementId: "page.section-nav",
    owner,
    variantTargets: expectedVariantTargets,
    context: "ui-generator add-subpages"
  });

  const result = await upgradePageFileToSubpages({
    appRoot,
    targetFile,
    target: outletTarget.id,
    title,
    subtitle,
    componentDirectory,
    preserveExistingContent: true,
    dryRun
  });

  const touchedFiles = new Set(result.touchedFiles);
  if (topologyApplied.changed) {
    if (dryRun !== true) {
      await writeFile(topologyPath.absolutePath, topologyApplied.content, "utf8");
    }
    touchedFiles.add(topologyPath.relativePath);
  }
  const touchedFileList = [...touchedFiles].sort((left, right) => left.localeCompare(right));

  return {
    touchedFiles: touchedFileList,
    summary:
      touchedFileList.length > 0
        ? `Enabled subpages in ${result.targetFile} for "${pageTarget.routeUrlSuffix}" using outlet target "${outletTarget.id}".`
        : `Subpages are already enabled in ${result.targetFile}.`
  };
}

export { runGeneratorSubcommand };
