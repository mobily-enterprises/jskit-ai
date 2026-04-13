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
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  resolvePathWithinApp,
  insertImportIfMissing,
  insertBeforeClassDeclaration,
  findScriptBlock,
  indentBlock
} from "./support.js";

const DEFAULT_SUBPAGES_POSITION = "sub-pages";
const SECTION_CONTAINER_SHELL_COMPONENT = "SectionContainerShell";
const TAB_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";
const DEFAULT_MENU_COMPONENT_DIRECTORY = path.join(DEFAULT_COMPONENT_DIRECTORY, "menus");
const TAB_LINK_COMPONENT_DEFINITION = findLocalLinkItemDefinition(TAB_LINK_COMPONENT_TOKEN);

if (!TAB_LINK_COMPONENT_DEFINITION) {
  throw new Error(`ui-generator add-subpages could not resolve ${TAB_LINK_COMPONENT_TOKEN} scaffold definition.`);
}

const TAB_LINK_COMPONENT = TAB_LINK_COMPONENT_DEFINITION.componentName;

const ROUTE_TAG_PATTERN = /<route\b[^>]*>[\s\S]*?<\/route>\s*/gi;
const TEMPLATE_TOKEN_PATTERN = /<\/?template\b[^>]*>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b[^>]*\/?>\s*/gi;
const ROUTER_VIEW_TAG_PATTERN = /<RouterView\b/i;
const ROUTER_VIEW_LINE_PATTERN = /^\s*<RouterView(?:\s[^>]*)?\s*\/>\s*$/gm;

function trimEdgeBlankLines(source = "") {
  return String(source || "")
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "");
}

function renderPlainPageSource(pageTitle = "") {
  return `<template>
  <section class="pa-4">
    <h1 class="text-h5 mb-2">${pageTitle}</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
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
    <v-card rounded="lg" elevation="1" border>
      <v-card-item v-if="hasHeading">
        <v-card-title v-if="resolvedTitle" class="px-0">{{ resolvedTitle }}</v-card-title>
        <v-card-subtitle v-if="resolvedSubtitle" class="px-0">{{ resolvedSubtitle }}</v-card-subtitle>
      </v-card-item>
      <template v-if="hasTabs">
        <v-divider v-if="hasHeading" />
        <v-card-text class="section-container-shell__tabs">
          <slot name="tabs" />
        </v-card-text>
      </template>
    </v-card>

    <slot />
  </section>
</template>

<style scoped>
.section-container-shell__tabs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.75rem;
  scrollbar-width: thin;
}

.section-container-shell__tabs :deep(.tab-link-item) {
  flex: 0 0 auto;
}

@media (max-width: 640px) {
  .section-container-shell__tabs {
    gap: 0.375rem;
    padding: 0.5rem;
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
    path.join(normalizedTabLinkComponentDirectory, `${TAB_LINK_COMPONENT}.vue`),
    { context: "ui-generator add-subpages" }
  );

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator add-subpages could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const providerRegisterLine = `registerMainClientComponent("${TAB_LINK_COMPONENT_TOKEN}", () => ${TAB_LINK_COMPONENT});`;
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
      desiredSource: await readLocalLinkItemComponentSource(TAB_LINK_COMPONENT_DEFINITION)
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

  const providerImportLine = `import ${TAB_LINK_COMPONENT} from "/${toPosixPath(path.join(normalizedTabLinkComponentDirectory, `${TAB_LINK_COMPONENT}.vue`))}";`;
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
    `      <ShellOutlet target="${normalizedTarget}" default-link-component-token="${TAB_LINK_COMPONENT_TOKEN}" />`,
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
  const scriptBlock = findScriptBlock(sourceText);

  const importLines = [
    "import ShellOutlet from \"@jskit-ai/shell-web/client/components/ShellOutlet\";",
    "import { RouterView } from \"vue-router\";",
    `import SectionContainerShell from "${sectionContainerComponentImportPath}";`
  ];

  if (!scriptBlock) {
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
  TAB_LINK_COMPONENT,
  TAB_LINK_COMPONENT_TOKEN,
  resolvePageTargetDetails,
  resolveNearestParentSubpagesHost,
  deriveDefaultSubpagesHost,
  renderPlainPageSource,
  ensureSubpagesSupportScaffold,
  applySubpagesUpgradeToPageSource,
  upgradePageFileToSubpages
};
