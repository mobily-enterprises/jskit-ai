import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  resolveRequiredAppRoot,
  resolveShellOutletPlacementTargetFromApp,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import {
  normalizeObject,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  PLACEMENT_FILE,
  toKebabCase,
  requireOption,
  resolvePathWithinApp,
  appendBlockIfMarkerMissing,
  insertImportIfMissing,
  insertBeforeClassDeclaration
} from "./support.js";

const CONTAINER_OUTLET_POSITION = "sub-pages";
const SECTION_CONTAINER_SHELL_COMPONENT = "SectionContainerShell";
const TAB_LINK_COMPONENT = "TabLinkItem";
const TAB_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";
const ROUTE_TAG_PATTERN = /<route\b([^>]*)>([\s\S]*?)<\/route>/;
const ATTRIBUTE_PATTERN = /([:@]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function isBracketRouteParamSegment(value = "") {
  return value.startsWith("[") && value.endsWith("]");
}

function normalizeRoutePrefixSegment(value = "") {
  const source = normalizeText(value);
  if (!source) {
    return "";
  }

  if (isBracketRouteParamSegment(source)) {
    return source;
  }

  return toKebabCase(source);
}

function normalizeRoutePrefix(value = "") {
  const source = normalizeText(value).replaceAll("\\", "/");
  if (!source) {
    return "";
  }

  const parts = source
    .split("/")
    .map((entry) => normalizeRoutePrefixSegment(entry))
    .filter(Boolean);
  return parts.join("/");
}

function resolveContainerRoutePath({ name = "", routePath = "" } = {}) {
  const rawRoutePath = normalizeText(routePath);
  const normalizedRoutePath = normalizeRoutePrefix(routePath);
  if (rawRoutePath && !normalizedRoutePath) {
    throw new Error("ui-generator container requires a valid --route-path when provided.");
  }
  if (normalizedRoutePath) {
    return normalizedRoutePath;
  }
  return toKebabCase(name);
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
    const attributeValue = hasValue ? String(match[2] ?? match[3] ?? "") : true;
    attributes[attributeName] = attributeValue;
  }

  return attributes;
}

function createContainerRouteMeta({
  surface = "",
  containerHost = "",
  containerPosition = CONTAINER_OUTLET_POSITION
} = {}) {
  return {
    meta: {
      jskit: {
        surface,
        placements: {
          outlets: [
            {
              host: containerHost,
              position: containerPosition
            }
          ]
        }
      }
    }
  };
}

function renderContainerRouteMetaBlock(routeMeta = {}) {
  return `<route lang="json">
${JSON.stringify(routeMeta, null, 2)}
</route>
`;
}

function normalizeOutletTargetId(outlet = {}) {
  const host = normalizeText(outlet?.host);
  const position = normalizeText(outlet?.position);
  if (!host || !position) {
    return "";
  }
  return `${host}:${position}`;
}

function ensureContainerRouteMetaOutlets(source = "", { surface = "", containerHost = "", containerPosition = "" } = {}) {
  const sourceText = String(source || "");
  const routeTagMatch = ROUTE_TAG_PATTERN.exec(sourceText);
  const expectedTargetId = normalizeOutletTargetId({
    host: containerHost,
    position: containerPosition
  });
  if (!expectedTargetId) {
    return {
      changed: false,
      content: sourceText
    };
  }

  if (!routeTagMatch) {
    const appendedContent = `${sourceText.trimEnd()}\n\n${renderContainerRouteMetaBlock(createContainerRouteMeta({
      surface,
      containerHost,
      containerPosition
    }))}`;
    return {
      changed: appendedContent !== sourceText,
      content: appendedContent
    };
  }

  const routeTagAttributes = parseTagAttributes(routeTagMatch[1]);
  const routeTagLanguage = normalizeText(routeTagAttributes.lang).toLowerCase();
  if (routeTagLanguage && routeTagLanguage !== "json") {
    return {
      changed: false,
      content: sourceText
    };
  }

  let routeMetaRecord = null;
  try {
    routeMetaRecord = JSON.parse(String(routeTagMatch[2] || "").trim());
  } catch {
    return {
      changed: false,
      content: sourceText
    };
  }

  const routeMeta = normalizeObject(routeMetaRecord);
  const metadata = normalizeObject(routeMeta.meta);
  const jskitMetadata = normalizeObject(metadata.jskit);
  const placementsMetadata = normalizeObject(jskitMetadata.placements);
  const outletRecords = Array.isArray(placementsMetadata.outlets) ? [...placementsMetadata.outlets] : [];
  const knownTargetIds = new Set(outletRecords.map((entry) => normalizeOutletTargetId(entry)).filter(Boolean));
  if (!knownTargetIds.has(expectedTargetId)) {
    outletRecords.push({
      host: containerHost,
      position: containerPosition
    });
  }

  const normalizedSurface = normalizeText(jskitMetadata.surface) || normalizeText(surface);
  const nextRouteMeta = {
    ...routeMeta,
    meta: {
      ...metadata,
      jskit: {
        ...jskitMetadata,
        surface: normalizedSurface,
        placements: {
          ...placementsMetadata,
          outlets: outletRecords
        }
      }
    }
  };
  const renderedRouteMeta = renderContainerRouteMetaBlock(nextRouteMeta);
  const replacementContent =
    `${sourceText.slice(0, routeTagMatch.index)}${renderedRouteMeta}${sourceText.slice(routeTagMatch.index + routeTagMatch[0].length)}`;
  return {
    changed: replacementContent !== sourceText,
    content: replacementContent
  };
}

async function loadPublicConfig(appRoot = "") {
  const configPath = path.join(appRoot, "config", "public.js");

  try {
    await readFile(configPath, "utf8");
  } catch {
    throw new Error("ui-generator container requires app config at config/public.js.");
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw new Error(
      `ui-generator container could not load config/public.js: ${String(error?.message || error || "unknown error")}`
    );
  }

  const config = normalizeObject(
    moduleNamespace?.config ||
    moduleNamespace?.default?.config ||
    moduleNamespace?.default
  );
  if (Object.keys(config).length < 1) {
    throw new Error("ui-generator container requires exported config in config/public.js.");
  }

  return config;
}

async function resolveSurfacePagesDirectory(appRoot = "", surfaceId = "") {
  const config = await loadPublicConfig(appRoot);
  const surfaceDefinitions = normalizeObject(config.surfaceDefinitions);
  const normalizedSurfaceId = normalizeText(surfaceId).toLowerCase();
  const surfaceDefinition = normalizeObject(surfaceDefinitions[normalizedSurfaceId]);
  if (Object.keys(surfaceDefinition).length < 1) {
    throw new Error(`ui-generator container surface "${normalizedSurfaceId}" is not defined in config/public.js.`);
  }
  if (surfaceDefinition.enabled === false) {
    throw new Error(`ui-generator container surface "${normalizedSurfaceId}" is disabled in config/public.js.`);
  }

  const pagesRoot = normalizeText(surfaceDefinition.pagesRoot);
  if (!pagesRoot) {
    return path.join(appRoot, "src", "pages");
  }
  return path.join(appRoot, "src", "pages", pagesRoot);
}

function renderSectionContainerShellSource() {
  return `<script setup>
import { computed } from "vue";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";

const props = defineProps({
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  host: {
    type: String,
    default: ""
  },
  position: {
    type: String,
    default: "${CONTAINER_OUTLET_POSITION}"
  }
});

const resolvedTitle = computed(() => String(props.title || "").trim() || "Section");
const resolvedSubtitle = computed(() => String(props.subtitle || "").trim());
</script>

<template>
  <section class="section-container-shell d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="px-0">{{ resolvedTitle }}</v-card-title>
        <v-card-subtitle v-if="resolvedSubtitle" class="px-0">{{ resolvedSubtitle }}</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="section-container-shell__tabs">
        <ShellOutlet :host="props.host" :position="props.position" />
      </v-card-text>
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
import { useWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useWorkspaceRouteContext";

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
const { currentSurfaceId, workspaceSlugFromRoute } = useWorkspaceRouteContext();

function normalizePathname(pathname = "") {
  const source = String(pathname || "").trim();
  if (!source) {
    return "";
  }

  const queryIndex = source.indexOf("?");
  const hashIndex = source.indexOf("#");
  const cutoff =
    queryIndex < 0
      ? hashIndex
      : hashIndex < 0
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  return cutoff < 0 ? source : source.slice(0, cutoff);
}

function interpolateBracketParams(pathTemplate = "", params = {}) {
  const source = String(pathTemplate || "").trim();
  if (!source) {
    return "";
  }

  return source.replace(/\\[([^\\]]+)\\]/g, (_match, rawKey) => {
    const key = String(rawKey || "").trim();
    if (!key) {
      return "";
    }
    const value = params?.[key];
    return value == null ? "[" + key + "]" : encodeURIComponent(String(value));
  });
}

const targetSurfaceId = computed(() => {
  const explicitSurface = String(props.surface || "").trim().toLowerCase();
  if (explicitSurface && explicitSurface !== "*") {
    return explicitSurface;
  }
  return String(currentSurfaceId.value || paths.currentSurfaceId.value || "").trim().toLowerCase();
});

const resolvedTo = computed(() => {
  const explicitTo = String(props.to || "").trim();
  if (explicitTo) {
    if (explicitTo.startsWith("./")) {
      const workspaceSlug = String(workspaceSlugFromRoute.value || "").trim();
      const suffixTemplate = workspaceSlug ? props.workspaceSuffix : props.nonWorkspaceSuffix;
      const interpolatedSuffix = interpolateBracketParams(suffixTemplate, route.params || {});
      if (interpolatedSuffix && !interpolatedSuffix.includes("[")) {
        return paths.page(interpolatedSuffix, {
          surface: targetSurfaceId.value,
          mode: "auto"
        });
      }
    }
    return explicitTo;
  }

  const workspaceSlug = String(workspaceSlugFromRoute.value || "").trim();
  const suffix = workspaceSlug ? props.workspaceSuffix : props.nonWorkspaceSuffix;
  const normalizedSuffix = String(suffix || "/").trim() || "/";
  return paths.page(normalizedSuffix, {
    surface: targetSurfaceId.value,
    mode: "auto"
  });
});

const isActive = computed(() => {
  const targetPathname = normalizePathname(resolvedTo.value);
  const currentPathname = normalizePathname(route.fullPath || route.path);
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

function renderContainerPageSource({
  surface = "",
  title = "",
  subtitle = "",
  containerHost = "",
  containerPosition = CONTAINER_OUTLET_POSITION,
  sectionContainerComponentImportPath = "/src/components/SectionContainerShell.vue"
} = {}) {
  const routeMeta = createContainerRouteMeta({
    surface,
    containerHost,
    containerPosition
  });
  return `<script setup>
import { RouterView } from "vue-router";
import SectionContainerShell from "${sectionContainerComponentImportPath}";
</script>

<template>
  <SectionContainerShell
    title="${title}"
    subtitle="${subtitle}"
    host="${containerHost}"
    position="${containerPosition}"
  >
    <RouterView />
  </SectionContainerShell>
</template>

${renderContainerRouteMetaBlock(routeMeta)}
`;
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "container") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  if (Array.isArray(args) && args.length > 0) {
    throw new Error("ui-generator container does not accept positional arguments.");
  }

  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "ui-generator container"
  });
  const name = requireOption(options, "name", { context: "ui-generator container" });
  const surface = requireOption(options, "surface", { context: "ui-generator container" }).toLowerCase();
  const routePrefix = normalizeRoutePrefix(options?.["directory-prefix"]);
  const componentDirectory = normalizeText(options?.path) || DEFAULT_COMPONENT_DIRECTORY;
  const containerRoutePath = resolveContainerRoutePath({
    name,
    routePath: options?.["route-path"]
  });
  const containerSlug = toKebabCase(name);
  if (!containerSlug || !containerRoutePath) {
    throw new Error("ui-generator container requires a valid --name.");
  }

  const routePath = routePrefix ? `${routePrefix}/${containerRoutePath}` : containerRoutePath;
  const pagesDirectory = await resolveSurfacePagesDirectory(resolvedAppRoot, surface);
  const containerFilePath = path.join(pagesDirectory, `${routePath}.vue`);
  const containerRelativePath = toPosixPath(path.relative(resolvedAppRoot, containerFilePath));
  const providerPath = resolvePathWithinApp(resolvedAppRoot, MAIN_CLIENT_PROVIDER_FILE, {
    context: "ui-generator container"
  });
  const sectionContainerShellPath = resolvePathWithinApp(
    resolvedAppRoot,
    path.join(componentDirectory, `${SECTION_CONTAINER_SHELL_COMPONENT}.vue`),
    {
      context: "ui-generator container"
    }
  );
  const sectionTabLinkPath = resolvePathWithinApp(
    resolvedAppRoot,
    path.join(componentDirectory, `${TAB_LINK_COMPONENT}.vue`),
    {
      context: "ui-generator container"
    }
  );

  const placementOption = normalizeText(options?.placement);
  const placementTarget = placementOption
    ? await resolveShellOutletPlacementTargetFromApp({
        appRoot: resolvedAppRoot,
        context: "ui-generator container",
        placement: placementOption
      })
    : null;

  const touchedFiles = new Set();

  let existingSectionContainerSource = "";
  try {
    existingSectionContainerSource = await readFile(sectionContainerShellPath.absolutePath, "utf8");
  } catch {
    existingSectionContainerSource = "";
  }
  if (!existingSectionContainerSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(sectionContainerShellPath.absolutePath), { recursive: true });
      await writeFile(sectionContainerShellPath.absolutePath, renderSectionContainerShellSource(), "utf8");
    }
    touchedFiles.add(sectionContainerShellPath.relativePath);
  }

  let existingSectionTabLinkSource = "";
  try {
    existingSectionTabLinkSource = await readFile(sectionTabLinkPath.absolutePath, "utf8");
  } catch {
    existingSectionTabLinkSource = "";
  }
  if (!existingSectionTabLinkSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(sectionTabLinkPath.absolutePath), { recursive: true });
      await writeFile(sectionTabLinkPath.absolutePath, renderTabLinkItemSource(), "utf8");
    }
    touchedFiles.add(sectionTabLinkPath.relativePath);
  }

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator container could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const providerImportLine = `import ${TAB_LINK_COMPONENT} from "/${toPosixPath(path.join(componentDirectory, `${TAB_LINK_COMPONENT}.vue`))}";`;
  const providerRegisterLine =
    `registerMainClientComponent("${TAB_LINK_COMPONENT_TOKEN}", () => ${TAB_LINK_COMPONENT});`;
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

  let existingContainerSource = "";
  try {
    existingContainerSource = await readFile(containerFilePath, "utf8");
  } catch {
    existingContainerSource = "";
  }
  if (!existingContainerSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(containerFilePath), { recursive: true });
      await writeFile(
        containerFilePath,
        renderContainerPageSource({
          surface,
          title: name,
          subtitle: `Manage ${toKebabCase(name).replaceAll("-", " ")} modules.`,
          containerHost: containerSlug,
          sectionContainerComponentImportPath: `/${toPosixPath(path.join(componentDirectory, `${SECTION_CONTAINER_SHELL_COMPONENT}.vue`))}`
        }),
        "utf8"
      );
    }
    touchedFiles.add(containerRelativePath);
  } else {
    const routeMetaApplied = ensureContainerRouteMetaOutlets(existingContainerSource, {
      surface,
      containerHost: containerSlug,
      containerPosition: CONTAINER_OUTLET_POSITION
    });
    if (routeMetaApplied.changed) {
      if (dryRun !== true) {
        await writeFile(containerFilePath, routeMetaApplied.content, "utf8");
      }
      touchedFiles.add(containerRelativePath);
    }
  }

  if (placementTarget) {
    const placementPath = resolvePathWithinApp(resolvedAppRoot, PLACEMENT_FILE, {
      context: "ui-generator container"
    });
    const placementSource = await readFile(placementPath.absolutePath, "utf8");
    const placementIdSuffix = routePath.replaceAll("/", "-");
    const placementMarker = `jskit:ui-generator.container.menu:${surface}:${routePath}`;
    const placementBlock =
      `// ${placementMarker}\n` +
      "{\n" +
      "  addPlacement({\n" +
      `    id: "ui-generator.container.${placementIdSuffix}.menu",\n` +
      `    host: "${placementTarget.host}",\n` +
      `    position: "${placementTarget.position}",\n` +
      `    surfaces: ["${surface}"],\n` +
      "    order: 155,\n" +
      '    componentToken: "users.web.shell.surface-aware-menu-link-item",\n' +
      "    props: {\n" +
      `      label: "${name}",\n` +
      `      surface: "${surface}",\n` +
      `      workspaceSuffix: "/${routePath}",\n` +
      `      nonWorkspaceSuffix: "/${routePath}"\n` +
      "    },\n" +
      "    when: ({ auth }) => Boolean(auth?.authenticated)\n" +
      "  });\n" +
      "}\n";
    const placementApplied = appendBlockIfMarkerMissing(placementSource, placementMarker, placementBlock);
    if (placementApplied.changed) {
      if (dryRun !== true) {
        await writeFile(placementPath.absolutePath, placementApplied.content, "utf8");
      }
      touchedFiles.add(placementPath.relativePath);
    }
  }

  const touchedFileList = [...touchedFiles].sort((left, right) => left.localeCompare(right));
  return {
    touchedFiles: touchedFileList,
    summary:
      touchedFileList.length > 0
        ? `Generated UI container "${routePath}" with outlet "${containerSlug}:${CONTAINER_OUTLET_POSITION}".`
        : `UI container "${routePath}" is already up to date.`
  };
}

export { runGeneratorSubcommand };
