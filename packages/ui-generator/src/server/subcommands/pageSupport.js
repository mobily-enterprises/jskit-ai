import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  resolveRequiredAppRoot,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import {
  normalizeObject,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeSurfaceId,
  normalizeSurfacePagesRoot
} from "@jskit-ai/kernel/shared/surface";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  resolvePathWithinApp,
  insertImportIfMissing,
  insertBeforeClassDeclaration,
  findScriptBlock,
  parseTagAttributes,
  indentBlock
} from "./support.js";

const DEFAULT_SUBPAGES_POSITION = "sub-pages";
const SECTION_CONTAINER_SHELL_COMPONENT = "SectionContainerShell";
const TAB_LINK_COMPONENT = "TabLinkItem";
const TAB_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";
const PAGE_ROOT_PREFIX = "src/pages/";

const ROUTE_TAG_PATTERN = /<route\b[^>]*>[\s\S]*?<\/route>\s*/gi;
const TEMPLATE_TOKEN_PATTERN = /<\/?template\b[^>]*>/gi;
const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b[^>]*\/?>\s*/gi;
const SHELL_OUTLET_TAG_CAPTURE_PATTERN = /<ShellOutlet\b([^>]*)\/?>/gi;
const ROUTER_VIEW_TAG_PATTERN = /<RouterView\b/i;
const ROUTER_VIEW_LINE_PATTERN = /^\s*<RouterView(?:\s[^>]*)?\s*\/>\s*$/gm;

function normalizeRelativeFilePath(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .trim();
}

function splitTextIntoWords(value = "") {
  const normalized = String(value || "")
    .replace(/^\[|\]$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}

function wordsToKebab(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function toTitleCase(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const value = String(word || "");
      if (!value) {
        return "";
      }
      return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function isRouteGroupSegment(value = "") {
  const normalizedValue = normalizeText(value);
  return normalizedValue.startsWith("(") && normalizedValue.endsWith(")");
}

function isNestedChildrenRouteGroupSegment(value = "") {
  const normalizedValue = normalizeText(value);
  if (!isRouteGroupSegment(normalizedValue)) {
    return false;
  }
  const groupName = normalizedValue.slice(1, -1).trim().toLowerCase();
  return groupName === "nestedchildren" || groupName === "nested-children";
}

function normalizePlacementIdSegment(value = "") {
  return wordsToKebab(splitTextIntoWords(value));
}

function humanizePageSegment(value = "", fallback = "Page") {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return fallback;
  }
  return toTitleCase(words);
}

function trimEdgeBlankLines(source = "") {
  return String(source || "")
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "");
}

function validateVueTargetFile(relativePath = "", { context = "ui-generator" } = {}) {
  const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
  if (!normalizedRelativePath.endsWith(".vue")) {
    throw new Error(`${context} target file must be a .vue file: ${normalizedRelativePath || "<empty>"}.`);
  }
  return normalizedRelativePath;
}

async function loadPublicConfig(appRoot = "", { context = "ui-generator" } = {}) {
  const configPath = path.join(appRoot, "config", "public.js");

  try {
    await readFile(configPath, "utf8");
  } catch {
    throw new Error(`${context} requires app config at config/public.js.`);
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw new Error(
      `${context} could not load config/public.js: ${String(error?.message || error || "unknown error")}`
    );
  }

  const config = normalizeObject(
    moduleNamespace?.config ||
    moduleNamespace?.default?.config ||
    moduleNamespace?.default
  );
  if (Object.keys(config).length < 1) {
    throw new Error(`${context} requires exported config in config/public.js.`);
  }

  return config;
}

async function listSurfacePageRoots(appRoot = "", { context = "ui-generator" } = {}) {
  const config = await loadPublicConfig(appRoot, { context });
  const surfaceDefinitions = normalizeObject(config.surfaceDefinitions);

  return Object.entries(surfaceDefinitions)
    .map(([key, value]) => {
      const definition = normalizeObject(value);
      const surfaceId = normalizeSurfaceId(definition.id || key);
      if (!surfaceId || definition.enabled === false) {
        return null;
      }

      return Object.freeze({
        id: surfaceId,
        pagesRoot: normalizeSurfacePagesRoot(definition.pagesRoot)
      });
    })
    .filter(Boolean);
}

function deriveSurfaceMatchesFromPageFile(relativePath = "", surfacePageRoots = []) {
  const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
  if (!normalizedRelativePath.startsWith(PAGE_ROOT_PREFIX)) {
    return [];
  }

  const pagePathWithinPagesRoot = normalizedRelativePath.slice(PAGE_ROOT_PREFIX.length);
  return (Array.isArray(surfacePageRoots) ? surfacePageRoots : [])
    .map((surface) => {
      const pagesRoot = normalizeSurfacePagesRoot(surface?.pagesRoot);
      if (!pagesRoot) {
        return Object.freeze({
          surfaceId: normalizeSurfaceId(surface?.id),
          pagesRoot,
          surfaceRelativeFilePath: pagePathWithinPagesRoot
        });
      }

      const requiredPrefix = `${pagesRoot}/`;
      if (!pagePathWithinPagesRoot.startsWith(requiredPrefix)) {
        return null;
      }

      return Object.freeze({
        surfaceId: normalizeSurfaceId(surface?.id),
        pagesRoot,
        surfaceRelativeFilePath: pagePathWithinPagesRoot.slice(requiredPrefix.length)
      });
    })
    .filter(Boolean);
}

function deriveRouteInfoFromSurfaceRelativeFile(surfaceRelativeFilePath = "", surfaceId = "") {
  const normalizedRelativeFilePath = validateVueTargetFile(surfaceRelativeFilePath, {
    context: "ui-generator page"
  });
  const withoutExtension = normalizedRelativeFilePath.slice(0, -".vue".length);
  const fileSegments = withoutExtension
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  const routeSegments = [...fileSegments];
  if (routeSegments[routeSegments.length - 1] === "index") {
    routeSegments.pop();
  }

  const visibleRouteSegments = routeSegments.filter((segment) => !isRouteGroupSegment(segment));
  const routeUrlSuffix = visibleRouteSegments.length > 0 ? `/${visibleRouteSegments.join("/")}` : "/";
  const placementIdSegments = visibleRouteSegments
    .map((segment) => normalizePlacementIdSegment(segment))
    .filter(Boolean);
  const pageLeafSegment = visibleRouteSegments[visibleRouteSegments.length - 1] || "";
  const defaultNameSource = pageLeafSegment || surfaceId || "page";
  const defaultName = humanizePageSegment(defaultNameSource, "Page");

  return Object.freeze({
    fileSegments,
    routeSegments,
    visibleRouteSegments,
    routeUrlSuffix,
    pageLeafSegment,
    defaultName,
    containsNestedChildrenGroup: routeSegments.some((segment) => isNestedChildrenRouteGroupSegment(segment)),
    placementId:
      placementIdSegments.length > 0
        ? `ui-generator.page.${placementIdSegments.join(".")}.link`
        : `ui-generator.page.${normalizePlacementIdSegment(surfaceId || "root") || "root"}.link`
  });
}

function deriveDefaultSubpagesHost(pageTarget = {}) {
  const visibleRouteSegments = Array.isArray(pageTarget?.visibleRouteSegments)
    ? pageTarget.visibleRouteSegments
    : [];
  const hostSegments = visibleRouteSegments
    .map((segment) => normalizePlacementIdSegment(segment))
    .filter(Boolean);

  if (hostSegments.length > 0) {
    return hostSegments.join("-");
  }

  return normalizePlacementIdSegment(pageTarget?.surfaceId || "page") || "page";
}

function buildRouteUrlSuffixFromVisibleSegments(segments = []) {
  const visibleSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  return visibleSegments.length > 0 ? `/${visibleSegments.join("/")}` : "/";
}

function buildAncestorRouteContexts(pageTarget = {}) {
  const routeSegments = Array.isArray(pageTarget?.routeSegments)
    ? pageTarget.routeSegments
    : [];
  const visibleRouteSegments = Array.isArray(pageTarget?.visibleRouteSegments)
    ? pageTarget.visibleRouteSegments
    : [];
  if (visibleRouteSegments.length < 2) {
    return [];
  }

  const ancestors = [];

  // A child page can sit under a parent route in two valid ways:
  // 1. Directly under a file route:       parent.vue -> parent/child/index.vue
  // 2. Under an index route via a group:  parent/index.vue -> parent/(nestedChildren)/child/index.vue
  //
  // To cover both cleanly, we keep the ancestor prefix exactly as it appears in the
  // current file path, including route groups. That lets us probe parent pages like:
  // - src/pages/.../catalog.vue
  // - src/pages/.../catalog/index.vue
  // - src/pages/.../catalog/(nestedChildren)/products/index.vue
  for (let visiblePrefixLength = visibleRouteSegments.length - 1; visiblePrefixLength >= 1; visiblePrefixLength -= 1) {
    const parentVisibleSegments = visibleRouteSegments.slice(0, visiblePrefixLength);
    const actualRouteSegments = [];
    let collectedVisibleSegments = 0;

    for (const segment of routeSegments) {
      actualRouteSegments.push(segment);
      if (!isRouteGroupSegment(segment)) {
        collectedVisibleSegments += 1;
      }
      if (collectedVisibleSegments >= visiblePrefixLength) {
        break;
      }
    }

    if (collectedVisibleSegments !== visiblePrefixLength) {
      continue;
    }

    const nextRouteSegment = normalizeText(routeSegments[actualRouteSegments.length]);
    ancestors.push(
      Object.freeze({
        visibleRouteSegments: parentVisibleSegments,
        actualRouteSegments,
        childUsesNestedChildrenGroup: isNestedChildrenRouteGroupSegment(nextRouteSegment)
      })
    );
  }

  return ancestors;
}

function buildParentPageFileCandidates(pageTarget = {}, ancestorRoute = {}) {
  const surfacePagesRootSegments = normalizeRelativeFilePath(pageTarget?.surfacePagesRoot)
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  const routeSegments = (Array.isArray(ancestorRoute?.actualRouteSegments) ? ancestorRoute.actualRouteSegments : [])
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (routeSegments.length < 1) {
    return [];
  }

  const baseSegments = ["src/pages", ...surfacePagesRootSegments, ...routeSegments];
  const fileRoutePath = `${baseSegments.join("/")}.vue`;
  const indexRoutePath = [...baseSegments, "index.vue"].join("/");

  // When the child route continues through a nestedChildren route group, the natural
  // owner is the ancestor index page. Otherwise the natural owner is the ancestor
  // file route. We still probe both shapes so a valid explicit parent is never missed.
  const preferredCandidates = ancestorRoute?.childUsesNestedChildrenGroup === true
    ? [indexRoutePath, fileRoutePath]
    : [fileRoutePath, indexRoutePath];

  return preferredCandidates.map((relativePath) =>
    Object.freeze({
      relativePath,
      pageShape: relativePath.endsWith("/index.vue") ? "index" : "file"
    })
  );
}

function resolveSubpagesHostTargetFromPageSource(source = "") {
  const sourceText = String(source || "");
  // A routed subpages host must render child routes. A plain ShellOutlet on its own
  // is not enough, because generic outlets are allowed on any page.
  if (!ROUTER_VIEW_TAG_PATTERN.test(sourceText)) {
    return null;
  }

  const targets = [];
  for (const match of sourceText.matchAll(SHELL_OUTLET_TAG_CAPTURE_PATTERN)) {
    const attributes = parseTagAttributes(match[1]);
    const host = normalizeText(attributes.host);
    const position = normalizeText(attributes.position);
    if (!host || !position) {
      continue;
    }
    targets.push(
      Object.freeze({
        id: `${host}:${position}`,
        host,
        position
      })
    );
  }

  // add-subpages creates exactly one routed subpages outlet per page. If we see zero
  // or multiple literal ShellOutlet targets here, the source is not a clean match.
  if (targets.length !== 1) {
    return null;
  }
  return targets[0];
}

async function resolveNearestParentSubpagesHost({
  appRoot,
  pageTarget = {},
  context = "ui-generator page"
} = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, { context });
  const ancestorRoutes = buildAncestorRouteContexts(pageTarget);
  if (ancestorRoutes.length < 1) {
    return null;
  }

  for (const ancestorRoute of ancestorRoutes) {
    const candidatePages = buildParentPageFileCandidates(pageTarget, ancestorRoute);

    for (const candidatePage of candidatePages) {
      const candidatePath = resolvePathWithinApp(resolvedAppRoot, candidatePage.relativePath, { context });
      let source = "";
      try {
        source = await readFile(candidatePath.absolutePath, "utf8");
      } catch {
        continue;
      }

      const target = resolveSubpagesHostTargetFromPageSource(source);
      if (!target) {
        continue;
      }

      return Object.freeze({
        ...target,
        pageFile: candidatePath.relativePath,
        pageShape: candidatePage.pageShape,
        visibleRouteSegments: ancestorRoute.visibleRouteSegments,
        routeUrlSuffix: buildRouteUrlSuffixFromVisibleSegments(ancestorRoute.visibleRouteSegments)
      });
    }
  }

  return null;
}

async function resolvePageTargetDetails({
  appRoot,
  targetFile = "",
  context = "ui-generator page"
} = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, { context });
  const targetPath = resolvePathWithinApp(resolvedAppRoot, targetFile, { context });
  const normalizedRelativePath = validateVueTargetFile(targetPath.relativePath, { context });

  if (!normalizedRelativePath.startsWith(PAGE_ROOT_PREFIX)) {
    throw new Error(`${context} target file must live under src/pages/: ${normalizedRelativePath}.`);
  }

  const surfacePageRoots = await listSurfacePageRoots(resolvedAppRoot, { context });
  const matches = deriveSurfaceMatchesFromPageFile(normalizedRelativePath, surfacePageRoots);
  if (matches.length < 1) {
    throw new Error(`${context} target file does not belong to any configured surface pagesRoot: ${normalizedRelativePath}.`);
  }
  if (matches.length > 1) {
    const surfaceIds = matches.map((match) => match.surfaceId).filter(Boolean).join(", ");
    throw new Error(`${context} target file matches multiple surfaces (${surfaceIds}): ${normalizedRelativePath}.`);
  }

  const surfaceMatch = matches[0];
  const routeInfo = deriveRouteInfoFromSurfaceRelativeFile(surfaceMatch.surfaceRelativeFilePath, surfaceMatch.surfaceId);

  return Object.freeze({
    appRoot: resolvedAppRoot,
    targetFilePath: targetPath,
    surfaceId: surfaceMatch.surfaceId,
    surfacePagesRoot: surfaceMatch.pagesRoot,
    surfaceRelativeFilePath: surfaceMatch.surfaceRelativeFilePath,
    ...routeInfo
  });
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

function renderTabLinkItemSource() {
  return `<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  normalizeMenuLinkPathname,
  resolveMenuLinkTarget
} from "@jskit-ai/users-web/client/support/menuLinkTarget";

const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
    type: String,
    default: ""
  },
  surface: {
    type: String,
    default: ""
  },
  workspaceSuffix: {
    type: String,
    default: "/"
  },
  nonWorkspaceSuffix: {
    type: String,
    default: "/"
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const route = useRoute();
const paths = usePaths();

const resolvedTo = computed(() => {
  return resolveMenuLinkTarget({
    to: props.to,
    surface: props.surface,
    currentSurfaceId: paths.currentSurfaceId.value,
    placementContext: paths.placementContext.value,
    workspaceSuffix: props.workspaceSuffix,
    nonWorkspaceSuffix: props.nonWorkspaceSuffix,
    routeParams: route.params || {},
    resolvePagePath(relativePath, options = {}) {
      return paths.page(relativePath, options);
    }
  });
});

const isActive = computed(() => {
  const targetPathname = normalizeMenuLinkPathname(resolvedTo.value);
  const currentPathname = normalizeMenuLinkPathname(route.fullPath || route.path);
  if (!targetPathname || !currentPathname) {
    return false;
  }
  return currentPathname === targetPathname || currentPathname.startsWith(\`\${targetPathname}/\`);
});
</script>

<template>
  <v-btn
    v-if="resolvedTo"
    class="tab-link-item text-none"
    :to="resolvedTo"
    rounded="pill"
    size="small"
    :variant="isActive ? 'flat' : 'tonal'"
    :color="isActive ? 'primary' : undefined"
    :disabled="props.disabled"
    :aria-current="isActive ? 'page' : undefined"
  >
    {{ props.label }}
  </v-btn>
</template>
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
    path.join(normalizedComponentDirectory, `${TAB_LINK_COMPONENT}.vue`),
    { context: "ui-generator add-subpages" }
  );

  const touchedFiles = new Set();
  const desiredSectionShellSource = renderSectionContainerShellSource();
  const desiredTabLinkSource = renderTabLinkItemSource();

  let sectionShellSource = "";
  try {
    sectionShellSource = await readFile(sectionContainerShellPath.absolutePath, "utf8");
  } catch {
    sectionShellSource = "";
  }
  if (sectionShellSource !== desiredSectionShellSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(sectionContainerShellPath.absolutePath), { recursive: true });
      await writeFile(sectionContainerShellPath.absolutePath, desiredSectionShellSource, "utf8");
    }
    touchedFiles.add(sectionContainerShellPath.relativePath);
  }

  let tabLinkSource = "";
  try {
    tabLinkSource = await readFile(tabLinkPath.absolutePath, "utf8");
  } catch {
    tabLinkSource = "";
  }
  if (tabLinkSource !== desiredTabLinkSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(tabLinkPath.absolutePath), { recursive: true });
      await writeFile(tabLinkPath.absolutePath, desiredTabLinkSource, "utf8");
    }
    touchedFiles.add(tabLinkPath.relativePath);
  }

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator add-subpages could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const providerImportLine = `import ${TAB_LINK_COMPONENT} from "/${toPosixPath(path.join(normalizedComponentDirectory, `${TAB_LINK_COMPONENT}.vue`))}";`;
  const providerRegisterLine = `registerMainClientComponent("${TAB_LINK_COMPONENT_TOKEN}", () => ${TAB_LINK_COMPONENT});`;
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
  host = "",
  position = DEFAULT_SUBPAGES_POSITION
} = {}) {
  const lines = [
    "<template>",
    renderSectionContainerOpenTag({ title, subtitle }),
    "    <template #tabs>",
    `      <ShellOutlet host="${host}" position="${position}" />`,
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
    host = "",
    position = DEFAULT_SUBPAGES_POSITION,
    title = "",
    subtitle = "",
    sectionContainerComponentImportPath = "/src/components/SectionContainerShell.vue",
    preserveExistingContent = true
  } = {}
) {
  const normalizedHost = normalizeText(host);
  const normalizedPosition = normalizeText(position) || DEFAULT_SUBPAGES_POSITION;
  if (!normalizedHost) {
    throw new Error("ui-generator add-subpages requires a valid host.");
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
    host: normalizedHost,
    position: normalizedPosition
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
  host = "",
  position = DEFAULT_SUBPAGES_POSITION,
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
    host,
    position,
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
  normalizeRelativeFilePath,
  loadPublicConfig,
  resolvePageTargetDetails,
  resolveNearestParentSubpagesHost,
  deriveDefaultSubpagesHost,
  renderPlainPageSource,
  ensureSubpagesSupportScaffold,
  applySubpagesUpgradeToPageSource,
  upgradePageFileToSubpages
};
