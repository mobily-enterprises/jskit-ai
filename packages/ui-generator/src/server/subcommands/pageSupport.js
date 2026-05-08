import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  deriveDefaultSubpagesHost,
  resolveNearestParentSubpagesHost,
  resolvePageTargetDetails,
  resolveRequiredAppRoot,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import { normalizeShellOutletTargetId } from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
import {
  findLocalLinkItemDefinition,
  readLocalLinkItemComponentSource
} from "@jskit-ai/shell-web/server/support/localLinkItemScaffolds";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  buildGeneratedUiScreenClassName,
  resolveGeneratedUiSurfaceProfile
} from "@jskit-ai/kernel/shared/support/generatedUiContract";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  resolvePathWithinApp,
  insertImportIfMissing,
  insertBeforeClassDeclaration,
  findScriptSetupBlock,
  insertScriptSetupBlock,
  indentBlock
} from "./support.js";

const DEFAULT_SUBPAGES_POSITION = "sub-pages";
const SECTION_CONTAINER_SHELL_COMPONENT = "SectionContainerShell";
const SUBPAGES_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";
const DEFAULT_MENU_COMPONENT_DIRECTORY = path.join(DEFAULT_COMPONENT_DIRECTORY, "menus");
const SUBPAGES_LINK_COMPONENT_DEFINITION = findLocalLinkItemDefinition(SUBPAGES_LINK_COMPONENT_TOKEN);
const OPERATOR_SURFACE_IDS = new Set(["admin", "console"]);

if (!SUBPAGES_LINK_COMPONENT_DEFINITION) {
  throw new Error(`ui-generator add-subpages could not resolve ${SUBPAGES_LINK_COMPONENT_TOKEN} scaffold definition.`);
}

const SUBPAGES_LINK_COMPONENT = SUBPAGES_LINK_COMPONENT_DEFINITION.componentName;

const TEMPLATE_TOKEN_PATTERN = /<\/?template\b[^>]*>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b[^>]*\/?>\s*/gi;
const ROUTER_VIEW_TAG_PATTERN = /<RouterView\b/i;
const ROUTER_VIEW_LINE_PATTERN = /^\s*<RouterView(?:\s[^>]*)?\s*\/>\s*$/gm;

function resolveGeneratedPageSurfaceProfile({
  surfaceId = "",
  routePath = ""
} = {}) {
  const routeSegments = normalizeText(routePath)
    .replaceAll("\\", "/")
    .split("/")
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  if (routeSegments.includes("settings")) {
    return "settings";
  }
  if (OPERATOR_SURFACE_IDS.has(normalizeText(surfaceId).toLowerCase())) {
    return "operator";
  }
  return "task";
}

function trimEdgeBlankLines(source = "") {
  return String(source || "")
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "");
}

function renderPlainPageSource(pageTitle = "", {
  surfaceId = "",
  routePath = ""
} = {}) {
  const surfaceProfileId = resolveGeneratedPageSurfaceProfile({ surfaceId, routePath });
  const surfaceProfile = resolveGeneratedUiSurfaceProfile(surfaceProfileId);
  const screenClass = buildGeneratedUiScreenClassName("generated-page-screen d-flex flex-column ga-4", {
    surfaceProfile: surfaceProfileId
  });
  return `<template>
  <section class="${screenClass}">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">${surfaceProfile.titleLabel}</p>
      <h1 class="generated-page-screen__title">${pageTitle}</h1>
    </header>

    <v-sheet rounded="lg" border class="generated-page-screen__empty-state">
      <h2 class="text-h6 mb-2">No ${pageTitle} activity yet</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        ${surfaceProfile.emptyStateBody}
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-panel-padding: 2rem 1.25rem;
  --generated-ui-screen-panel-align: center;
}

.generated-ui-screen--operator {
  --generated-ui-screen-panel-padding: 1.5rem 1rem;
}

.generated-ui-screen--settings {
  --generated-ui-screen-panel-padding: 1.5rem 1rem;
}

.generated-page-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0;
}

.generated-page-screen__empty-state {
  margin-inline: auto;
  max-width: 34rem;
  padding: var(--generated-ui-screen-panel-padding);
  text-align: var(--generated-ui-screen-panel-align);
  width: 100%;
}
</style>
`;
}

function renderSectionContainerShellSource() {
  return `<script setup>
import { computed, useSlots } from "vue";

const props = defineProps({
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  }
});

const slots = useSlots();
const resolvedTitle = computed(() => String(props.title || "").trim());
const resolvedSubtitle = computed(() => String(props.subtitle || "").trim());
const hasHeading = computed(() => Boolean(resolvedTitle.value || resolvedSubtitle.value));
const hasTabs = computed(() => Boolean(slots.tabs));
</script>

<template>
  <section class="section-container-shell d-flex flex-column ga-4">
    <header v-if="hasHeading" class="section-container-shell__heading">
      <h1 v-if="resolvedTitle" class="section-container-shell__title">{{ resolvedTitle }}</h1>
      <p v-if="resolvedSubtitle" class="text-body-2 text-medium-emphasis mb-0">{{ resolvedSubtitle }}</p>
    </header>

    <v-sheet v-if="hasTabs" rounded="lg" border class="section-container-shell__nav">
      <slot name="tabs" />
    </v-sheet>

    <slot />
  </section>
</template>

<style scoped>
.section-container-shell__heading {
  min-width: 0;
}

.section-container-shell__title {
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.section-container-shell__nav {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.5rem;
  scrollbar-width: thin;
}

.section-container-shell__nav :deep(.tab-link-item) {
  flex: 0 0 auto;
  min-height: 48px;
}

@media (max-width: 640px) {
  .section-container-shell__nav {
    gap: 0.375rem;
    margin-inline: -0.25rem;
  }
}
</style>
`;
}

async function ensureSubpagesSupportScaffold({
  appRoot,
  componentDirectory = DEFAULT_COMPONENT_DIRECTORY,
  dryRun = false
} = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "ui-generator add-subpages"
  });
  const normalizedComponentDirectory = normalizeText(componentDirectory) || DEFAULT_COMPONENT_DIRECTORY;
  const normalizedTabLinkComponentDirectory =
    normalizedComponentDirectory === DEFAULT_COMPONENT_DIRECTORY
      ? DEFAULT_MENU_COMPONENT_DIRECTORY
      : normalizedComponentDirectory;
  const providerPath = resolvePathWithinApp(resolvedAppRoot, MAIN_CLIENT_PROVIDER_FILE, {
    context: "ui-generator add-subpages"
  });
  const sectionContainerShellPath = resolvePathWithinApp(
    resolvedAppRoot,
    path.join(normalizedComponentDirectory, `${SECTION_CONTAINER_SHELL_COMPONENT}.vue`),
    { context: "ui-generator add-subpages" }
  );
  const tabLinkPath = resolvePathWithinApp(
    resolvedAppRoot,
    path.join(normalizedTabLinkComponentDirectory, `${SUBPAGES_LINK_COMPONENT}.vue`),
    { context: "ui-generator add-subpages" }
  );

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator add-subpages could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const providerRegisterLine = `registerMainClientComponent("${SUBPAGES_LINK_COMPONENT_TOKEN}", () => ${SUBPAGES_LINK_COMPONENT});`;
  const providerHasTabLinkRegistration = providerSource.includes(providerRegisterLine);
  const touchedFiles = new Set();
  const supportFiles = [
    {
      path: sectionContainerShellPath,
      desiredSource: renderSectionContainerShellSource()
    }
  ];
  if (!providerHasTabLinkRegistration) {
    supportFiles.push({
      path: tabLinkPath,
      desiredSource: await readLocalLinkItemComponentSource(SUBPAGES_LINK_COMPONENT_DEFINITION)
    });
  }

  for (const supportFile of supportFiles) {
    let alreadyExists = true;
    try {
      await readFile(supportFile.path.absolutePath, "utf8");
    } catch {
      alreadyExists = false;
    }

    if (alreadyExists) {
      continue;
    }

    if (dryRun !== true) {
      await mkdir(path.dirname(supportFile.path.absolutePath), { recursive: true });
      await writeFile(supportFile.path.absolutePath, supportFile.desiredSource, "utf8");
    }
    touchedFiles.add(supportFile.path.relativePath);
  }

  const providerImportLine = `import ${SUBPAGES_LINK_COMPONENT} from "/${toPosixPath(path.join(normalizedTabLinkComponentDirectory, `${SUBPAGES_LINK_COMPONENT}.vue`))}";`;
  if (providerHasTabLinkRegistration) {
    return Object.freeze({
      touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
      sectionContainerComponentImportPath: `/${toPosixPath(path.join(normalizedComponentDirectory, `${SECTION_CONTAINER_SHELL_COMPONENT}.vue`))}`
    });
  }
  const providerImportApplied = insertImportIfMissing(providerSource, providerImportLine);
  const providerRegisterApplied = insertBeforeClassDeclaration(
    providerImportApplied.content,
    providerRegisterLine,
    {
      className: "MainClientProvider",
      contextFile: MAIN_CLIENT_PROVIDER_FILE
    }
  );
  if (providerImportApplied.changed || providerRegisterApplied.changed) {
    if (dryRun !== true) {
      await writeFile(providerPath.absolutePath, providerRegisterApplied.content, "utf8");
    }
    touchedFiles.add(providerPath.relativePath);
  }

  return Object.freeze({
    touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
    sectionContainerComponentImportPath: `/${toPosixPath(path.join(normalizedComponentDirectory, `${SECTION_CONTAINER_SHELL_COMPONENT}.vue`))}`
  });
}

function findTemplateBlock(source = "") {
  const sourceText = String(source || "");
  let openIndex = -1;
  let openTagSource = "";
  let openAttributesSource = "";
  let depth = 0;

  for (const match of sourceText.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const tokenSource = String(match[0] || "");
    const tokenIndex = Number(match.index);
    const isClosingToken = /^<\/template/i.test(tokenSource);

    if (!isClosingToken) {
      if (openIndex < 0) {
        openIndex = tokenIndex;
        openTagSource = tokenSource;
        const openTagMatch = /^<template\b([^>]*)>$/i.exec(tokenSource);
        openAttributesSource = String(openTagMatch?.[1] || "");
      }
      depth += 1;
      continue;
    }

    if (openIndex < 0) {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      const closeIndex = tokenIndex;
      const endIndex = closeIndex + tokenSource.length;
      return Object.freeze({
        index: openIndex,
        source: sourceText.slice(openIndex, endIndex),
        attributesSource: openAttributesSource,
        content: sourceText.slice(openIndex + openTagSource.length, closeIndex)
      });
    }
  }

  return null;
}

function unwrapSectionContainerShell(source = "") {
  const trimmedSource = trimEdgeBlankLines(source);
  const match = /^\s*<SectionContainerShell\b[^>]*>([\s\S]*?)<\/SectionContainerShell>\s*$/i.exec(trimmedSource);
  if (!match) {
    return trimmedSource;
  }

  let nextContent = String(match[1] || "");
  nextContent = nextContent.replace(/^\s*<template\b[^>]*#tabs[^>]*>[\s\S]*?<\/template>\s*/i, "");
  nextContent = nextContent.replace(ROUTER_VIEW_LINE_PATTERN, "");
  nextContent = nextContent.replace(SHELL_OUTLET_TAG_PATTERN, "");
  return trimEdgeBlankLines(nextContent);
}

function stripExistingSubpagesStructure(source = "") {
  const nextContent = unwrapSectionContainerShell(source)
    .replace(SHELL_OUTLET_TAG_PATTERN, "")
    .replace(ROUTER_VIEW_LINE_PATTERN, "");
  return trimEdgeBlankLines(nextContent);
}

function renderSectionContainerOpenTag({ title = "", subtitle = "" } = {}) {
  const lines = ["  <SectionContainerShell"];
  if (normalizeText(title)) {
    lines.push(`    title=${JSON.stringify(normalizeText(title))}`);
  }
  if (normalizeText(subtitle)) {
    lines.push(`    subtitle=${JSON.stringify(normalizeText(subtitle))}`);
  }
  if (lines.length === 1) {
    return "  <SectionContainerShell>";
  }
  return `${lines.join("\n")}\n  >`;
}

function renderSubpagesTemplate({
  bodyContent = "",
  title = "",
  subtitle = "",
  target = ""
} = {}) {
  const normalizedTarget = normalizeShellOutletTargetId(target);
  if (!normalizedTarget) {
    throw new Error("ui-generator add-subpages requires target in \"host:position\" format.");
  }

  const lines = [
    "<template>",
    renderSectionContainerOpenTag({ title, subtitle }),
    "    <template #tabs>",
    `      <ShellOutlet target="${normalizedTarget}" />`,
    "    </template>"
  ];

  const normalizedBodyContent = trimEdgeBlankLines(bodyContent);
  if (normalizedBodyContent) {
    lines.push("");
    lines.push(indentBlock(normalizedBodyContent, "    "));
  }

  lines.push("");
  lines.push("    <RouterView />");
  lines.push("  </SectionContainerShell>");
  lines.push("</template>");
  return `${lines.join("\n")}\n`;
}

function applySubpagesScriptImports(source = "", { sectionContainerComponentImportPath = "" } = {}) {
  const sourceText = String(source || "");
  const scriptBlock = findScriptSetupBlock(sourceText);

  const importLines = [
    "import ShellOutlet from \"@jskit-ai/shell-web/client/components/ShellOutlet\";",
    "import { RouterView } from \"vue-router\";",
    `import SectionContainerShell from "${sectionContainerComponentImportPath}";`
  ];

  if (!scriptBlock) {
    return insertScriptSetupBlock(sourceText, importLines.join("\n"));
  }

  let nextScriptContent = scriptBlock.content;
  let changed = false;
  for (const importLine of importLines) {
    const importApplied = insertImportIfMissing(nextScriptContent, importLine);
    nextScriptContent = importApplied.content;
    changed = changed || importApplied.changed;
  }

  if (!changed) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const nextScriptTag = `<script${scriptBlock.attributesSource}>${nextScriptContent}</script>`;
  return {
    changed: true,
    content: `${sourceText.slice(0, scriptBlock.index)}${nextScriptTag}${sourceText.slice(scriptBlock.index + scriptBlock.source.length)}`
  };
}

function applySubpagesUpgradeToPageSource(
  source = "",
  {
    target = "",
    title = "",
    subtitle = "",
    sectionContainerComponentImportPath = "/src/components/SectionContainerShell.vue",
    preserveExistingContent = true
  } = {}
) {
  const normalizedTarget = normalizeShellOutletTargetId(target);
  if (!normalizedTarget) {
    throw new Error('ui-generator add-subpages requires target in "host:position" format.');
  }

  const sourceText = String(source || "");
  const templateBlock = findTemplateBlock(sourceText);
  const existingTemplateContent = templateBlock ? templateBlock.content : "";
  const bodyContent = preserveExistingContent
    ? stripExistingSubpagesStructure(existingTemplateContent)
    : "";
  const replacementTemplate = renderSubpagesTemplate({
    bodyContent,
    title,
    subtitle,
    target: normalizedTarget
  });

  const nextSource = templateBlock
    ? `${sourceText.slice(0, templateBlock.index)}${replacementTemplate}${sourceText.slice(templateBlock.index + templateBlock.source.length)}`
    : `${sourceText}\n${replacementTemplate}`;
  const scriptApplied = applySubpagesScriptImports(nextSource, {
    sectionContainerComponentImportPath
  });

  return {
    changed: scriptApplied.content !== sourceText,
    content: scriptApplied.content
  };
}

function hasExistingSubpagesRouting(source = "") {
  return ROUTER_VIEW_TAG_PATTERN.test(String(source || ""));
}

async function upgradePageFileToSubpages({
  appRoot,
  targetFile,
  target = "",
  title = "",
  subtitle = "",
  componentDirectory = DEFAULT_COMPONENT_DIRECTORY,
  preserveExistingContent = true,
  dryRun = false
} = {}) {
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator add-subpages"
  });

  let source = "";
  try {
    source = await readFile(pageTarget.targetFilePath.absolutePath, "utf8");
  } catch {
    throw new Error(`ui-generator add-subpages target file not found: ${pageTarget.targetFilePath.relativePath}.`);
  }

  if (hasExistingSubpagesRouting(source)) {
    throw new Error(
      `ui-generator add-subpages found existing RouterView in ${pageTarget.targetFilePath.relativePath}. Subpages are already enabled.`
    );
  }

  const supportScaffold = await ensureSubpagesSupportScaffold({
    appRoot,
    componentDirectory,
    dryRun
  });

  const upgradeApplied = applySubpagesUpgradeToPageSource(source, {
    target,
    title,
    subtitle,
    sectionContainerComponentImportPath: supportScaffold.sectionContainerComponentImportPath,
    preserveExistingContent
  });

  const touchedFiles = new Set(supportScaffold.touchedFiles);
  if (upgradeApplied.changed) {
    if (dryRun !== true) {
      await writeFile(pageTarget.targetFilePath.absolutePath, upgradeApplied.content, "utf8");
    }
    touchedFiles.add(pageTarget.targetFilePath.relativePath);
  }

  return Object.freeze({
    touchedFiles: [...touchedFiles].sort((left, right) => left.localeCompare(right)),
    targetFile: pageTarget.targetFilePath.relativePath,
    surfaceId: pageTarget.surfaceId,
    routeUrlSuffix: pageTarget.routeUrlSuffix
  });
}

export {
  DEFAULT_SUBPAGES_POSITION,
  DEFAULT_COMPONENT_DIRECTORY,
  SECTION_CONTAINER_SHELL_COMPONENT,
  SUBPAGES_LINK_COMPONENT,
  SUBPAGES_LINK_COMPONENT_TOKEN,
  resolvePageTargetDetails,
  resolveNearestParentSubpagesHost,
  deriveDefaultSubpagesHost,
  renderPlainPageSource,
  ensureSubpagesSupportScaffold,
  applySubpagesUpgradeToPageSource,
  upgradePageFileToSubpages
};
