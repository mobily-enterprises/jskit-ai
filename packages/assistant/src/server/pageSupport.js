import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const PAGE_TEMPLATE_FILE = "../../templates/src/pages/assistant/index.vue";
const SETTINGS_PAGE_TEMPLATE_FILE = "../../templates/src/pages/settings/assistant/index.vue";

function resolveLinkToPropLine(linkTo = "") {
  if (!linkTo) {
    return "";
  }
  return `      to: ${JSON.stringify(linkTo)},\n`;
}

function resolveTemplateFilePath(relativePath = "") {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readAssistantPageTemplateSource(kind = "page") {
  const templateFilePath =
    kind === "settings-page"
      ? resolveTemplateFilePath(SETTINGS_PAGE_TEMPLATE_FILE)
      : resolveTemplateFilePath(PAGE_TEMPLATE_FILE);
  return readFile(templateFilePath, "utf8");
}

function renderAssistantPageSource(templateSource = "", surfaceId = "") {
  return String(templateSource || "").replaceAll("__ASSISTANT_SURFACE_ID__", String(surfaceId || ""));
}

async function resolveAssistantPageGenerationContext({
  appRoot,
  targetFile = "",
  options = {},
  context = "assistant page"
} = {}) {
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context
  });
  const linkTarget = await resolvePageLinkTargetDetails({
    appRoot: pageTarget.appRoot,
    pageTarget,
    targetFile,
    context,
    placement: options?.["link-placement"],
    componentToken: options?.["link-component-token"],
    linkTo: options?.["link-to"]
  });

  return Object.freeze({
    pageTarget,
    pageLabel: normalizeText(options?.name) || pageTarget.defaultName,
    linkPlacementHost: String(linkTarget.placementTarget?.host || ""),
    linkPlacementPosition: String(linkTarget.placementTarget?.position || ""),
    linkComponentToken: String(linkTarget.componentToken || ""),
    linkWorkspaceSuffix: pageTarget.routeUrlSuffix,
    linkNonWorkspaceSuffix: pageTarget.routeUrlSuffix,
    linkToPropLine: resolveLinkToPropLine(linkTarget.linkTo)
  });
}

function renderAssistantPageLinkPlacementBlock({
  marker = "",
  pageTarget = {},
  generationContext = {}
} = {}) {
  return (
    `// ${marker}\n` +
    "{\n" +
    "  addPlacement({\n" +
    `    id: "${String(pageTarget?.placementId || "")}",\n` +
    `    host: "${String(generationContext?.linkPlacementHost || "")}",\n` +
    `    position: "${String(generationContext?.linkPlacementPosition || "")}",\n` +
    `    surfaces: ["${String(pageTarget?.surfaceId || "")}"],\n` +
    "    order: 155,\n" +
    `    componentToken: "${String(generationContext?.linkComponentToken || "")}",\n` +
    "    props: {\n" +
    `      label: "${String(generationContext?.pageLabel || "")}",\n` +
    `      surface: "${String(pageTarget?.surfaceId || "")}",\n` +
    `      workspaceSuffix: "${String(generationContext?.linkWorkspaceSuffix || "")}",\n` +
    `      nonWorkspaceSuffix: "${String(generationContext?.linkNonWorkspaceSuffix || "")}",\n` +
    `${String(generationContext?.linkToPropLine || "")}    },\n` +
    "    when: ({ auth }) => Boolean(auth?.authenticated)\n" +
    "  });\n" +
    "}\n"
  );
}

function renderAssistantPageSummary(
  pageTarget = {},
  { pageAlreadyExisted = false, pageOverwritten = false, placementChanged = false } = {}
) {
  if (!pageAlreadyExisted) {
    return `Generated assistant page "${String(pageTarget?.routeUrlSuffix || "")}".`;
  }
  if (pageOverwritten) {
    return `Regenerated assistant page "${String(pageTarget?.routeUrlSuffix || "")}".`;
  }
  if (placementChanged) {
    return `Updated assistant page link placement for "${String(pageTarget?.routeUrlSuffix || "")}".`;
  }
  return `Assistant page "${String(pageTarget?.routeUrlSuffix || "")}" is already up to date.`;
}

export {
  readAssistantPageTemplateSource,
  renderAssistantPageSource,
  resolveAssistantPageGenerationContext,
  renderAssistantPageLinkPlacementBlock,
  renderAssistantPageSummary
};
