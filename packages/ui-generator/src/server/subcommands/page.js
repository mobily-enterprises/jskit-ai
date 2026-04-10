import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { buildUiPageTemplateContext } from "../buildTemplateContext.js";
import {
  PLACEMENT_FILE,
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions,
  resolvePathWithinApp,
  appendBlockIfMarkerMissing
} from "./support.js";
import {
  resolvePageTargetDetails,
  renderPlainPageSource,
} from "./pageSupport.js";

function renderPageLinkPlacementBlock({
  marker = "",
  context = {},
  label = "",
  surface = ""
} = {}) {
  return (
    `// ${marker}\n` +
    "{\n" +
    "  addPlacement({\n" +
    `    id: "${context.__JSKIT_UI_LINK_PLACEMENT_ID__}",\n` +
    `    host: "${context.__JSKIT_UI_LINK_PLACEMENT_HOST__}",\n` +
    `    position: "${context.__JSKIT_UI_LINK_PLACEMENT_POSITION__}",\n` +
    `    surfaces: ["${surface}"],\n` +
    "    order: 155,\n" +
    `    componentToken: "${context.__JSKIT_UI_LINK_COMPONENT_TOKEN__}",\n` +
    "    props: {\n" +
    `      label: "${label}",\n` +
    `      surface: "${surface}",\n` +
    `      workspaceSuffix: "${context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__}",\n` +
    `      nonWorkspaceSuffix: "${context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__}",\n` +
    `${context.__JSKIT_UI_LINK_TO_PROP_LINE__}    },\n` +
    "    when: ({ auth }) => Boolean(auth?.authenticated)\n" +
    "  });\n" +
    "}\n"
  );
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "page") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator page" });
  rejectUnexpectedOptions(
    options,
    ["name", "link-placement", "link-component-token", "link-to"],
    { context: "ui-generator page" }
  );

  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator page"
  });
  const pageLabel = normalizeText(options?.name) || pageTarget.defaultName;
  const pageFilePath = pageTarget.targetFilePath.absolutePath;
  const pageRelativePath = pageTarget.targetFilePath.relativePath;

  const touchedFiles = new Set();
  let pageAlreadyExisted = true;
  try {
    await readFile(pageFilePath, "utf8");
  } catch {
    pageAlreadyExisted = false;
  }

  if (!pageAlreadyExisted) {
    if (dryRun !== true) {
      await mkdir(path.dirname(pageFilePath), { recursive: true });
      await writeFile(pageFilePath, renderPlainPageSource(pageLabel), "utf8");
    }
    touchedFiles.add(pageRelativePath);
  }

  const placementContext = await buildUiPageTemplateContext({
    appRoot: pageTarget.appRoot,
    targetFile,
    options
  });
  const placementPath = resolvePathWithinApp(pageTarget.appRoot, PLACEMENT_FILE, {
    context: "ui-generator page"
  });
  const placementSource = await readFile(placementPath.absolutePath, "utf8");
  const placementMarker = `jskit:ui-generator.page.link:${pageTarget.surfaceId}:${pageTarget.routeUrlSuffix}`;
  const placementApplied = appendBlockIfMarkerMissing(
    placementSource,
    placementMarker,
    renderPageLinkPlacementBlock({
      marker: placementMarker,
      context: placementContext,
      label: pageLabel,
      surface: pageTarget.surfaceId
    })
  );
  if (placementApplied.changed) {
    if (dryRun !== true) {
      await writeFile(placementPath.absolutePath, placementApplied.content, "utf8");
    }
    touchedFiles.add(placementPath.relativePath);
  }

  const touchedFileList = [...touchedFiles].sort((left, right) => left.localeCompare(right));
  const summaryParts = [];
  if (!pageAlreadyExisted) {
    summaryParts.push(`Generated UI page "${pageTarget.routeUrlSuffix}" at ${pageRelativePath}.`);
  } else if (placementApplied.changed) {
    summaryParts.push(`Updated page link placement for existing UI page "${pageTarget.routeUrlSuffix}".`);
  } else {
    summaryParts.push(`UI page "${pageTarget.routeUrlSuffix}" is already up to date.`);
  }

  return {
    touchedFiles: touchedFileList,
    summary: summaryParts.join(" ")
  };
}

export { runGeneratorSubcommand };
