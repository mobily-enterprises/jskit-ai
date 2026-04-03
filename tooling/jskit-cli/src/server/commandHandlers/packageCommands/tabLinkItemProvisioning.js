import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const TAB_LINK_COMPONENT_FILE = "src/components/TabLinkItem.vue";
const TAB_LINK_COMPONENT_NAME = "TabLinkItem";
const TAB_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";

function toPosixPath(value = "") {
  return String(value || "").replaceAll("\\", "/");
}

function ensureTrailingNewline(value = "") {
  const source = String(value || "");
  return source.endsWith("\n") ? source : `${source}\n`;
}

function insertImportIfMissing(source = "", importLine = "") {
  const normalizedImportLine = String(importLine || "").trim();
  const sourceText = String(source || "");
  if (!normalizedImportLine || sourceText.includes(normalizedImportLine)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const importPattern = /^import\s+[^;]+;\s*$/gm;
  let match = null;
  let insertionIndex = 0;
  while ((match = importPattern.exec(sourceText)) !== null) {
    insertionIndex = match.index + match[0].length;
  }

  if (insertionIndex > 0) {
    return {
      changed: true,
      content: `${sourceText.slice(0, insertionIndex)}\n${normalizedImportLine}${sourceText.slice(insertionIndex)}`
    };
  }

  return {
    changed: true,
    content: `${normalizedImportLine}\n${sourceText}`
  };
}

function insertBeforeClassDeclaration(source = "", line = "", { className = "", contextFile = "" } = {}) {
  const normalizedLine = String(line || "").trim();
  const sourceText = String(source || "");
  if (!normalizedLine || sourceText.includes(normalizedLine)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const classPattern = new RegExp(`^class\\s+${String(className || "").trim()}\\b`, "m");
  const classMatch = classPattern.exec(sourceText);
  if (!classMatch) {
    throw new Error(`crud-ui-generator could not find ${className} class declaration in ${contextFile || "target file"}.`);
  }

  return {
    changed: true,
    content: `${sourceText.slice(0, classMatch.index)}${normalizedLine}\n\n${sourceText.slice(classMatch.index)}`
  };
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
  const targetPath = normalizePathname(resolvedTo.value);
  const currentPath = normalizePathname(route.fullPath || route.path || "");
  if (!targetPath || !currentPath) {
    return false;
  }
  return currentPath === targetPath || currentPath.startsWith(\`\${targetPath}/\`);
});
</script>

<template>
  <v-btn
    class="tab-link-item"
    variant="text"
    size="small"
    :to="resolvedTo"
    :active="isActive"
    :disabled="disabled"
    color="primary"
  >
    {{ label || "Tab" }}
  </v-btn>
</template>

<style scoped>
.tab-link-item {
  text-transform: none;
  font-weight: 600;
  border-radius: 999px;
}
</style>
`;
}

async function readUtf8FileIfExists(absolutePath = "") {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function ensureTabLinkItemComponentFile({ appRoot = "", dryRun = false, touchedFiles = new Set() } = {}) {
  const componentRelativePath = TAB_LINK_COMPONENT_FILE;
  const componentAbsolutePath = path.join(appRoot, componentRelativePath);
  const existingComponentSource = await readUtf8FileIfExists(componentAbsolutePath);
  if (existingComponentSource) {
    return;
  }

  if (dryRun !== true) {
    await mkdir(path.dirname(componentAbsolutePath), { recursive: true });
    await writeFile(componentAbsolutePath, renderTabLinkItemSource(), "utf8");
  }
  touchedFiles.add(toPosixPath(componentRelativePath));
}

function hasTabLinkItemTokenRegistration(providerSource = "") {
  const tokenPattern = TAB_LINK_COMPONENT_TOKEN.replaceAll(".", "\\.");
  const pattern = new RegExp(`registerMainClientComponent\\(\\s*"${tokenPattern}"\\s*,`, "m");
  return pattern.test(String(providerSource || ""));
}

async function loadMainClientProviderSource({ appRoot = "", createCliError } = {}) {
  const providerAbsolutePath = path.join(appRoot, MAIN_CLIENT_PROVIDER_FILE);
  let providerSource = "";
  try {
    providerSource = await readFile(providerAbsolutePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createCliError(
        `crud-ui-generator placement component token "${TAB_LINK_COMPONENT_TOKEN}" requires ${MAIN_CLIENT_PROVIDER_FILE}.`
      );
    }
    throw error;
  }

  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw createCliError(
      `crud-ui-generator placement component token "${TAB_LINK_COMPONENT_TOKEN}" could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  return providerSource;
}

async function ensureTabLinkItemProviderRegistration({
  appRoot = "",
  createCliError,
  dryRun = false,
  touchedFiles = new Set()
} = {}) {
  const providerRelativePath = MAIN_CLIENT_PROVIDER_FILE;
  const providerAbsolutePath = path.join(appRoot, providerRelativePath);
  const providerSource = await loadMainClientProviderSource({
    appRoot,
    createCliError
  });
  if (hasTabLinkItemTokenRegistration(providerSource)) {
    return false;
  }

  const importLine = `import ${TAB_LINK_COMPONENT_NAME} from "/${toPosixPath(TAB_LINK_COMPONENT_FILE)}";`;
  const registerLine = `registerMainClientComponent("${TAB_LINK_COMPONENT_TOKEN}", () => ${TAB_LINK_COMPONENT_NAME});`;

  const importApplied = insertImportIfMissing(providerSource, importLine);
  const registerApplied = insertBeforeClassDeclaration(importApplied.content, registerLine, {
    className: "MainClientProvider",
    contextFile: MAIN_CLIENT_PROVIDER_FILE
  });

  if (!importApplied.changed && !registerApplied.changed) {
    return false;
  }

  if (dryRun !== true) {
    await writeFile(providerAbsolutePath, ensureTrailingNewline(registerApplied.content), "utf8");
  }
  touchedFiles.add(toPosixPath(providerRelativePath));
  return true;
}

async function ensureLocalMainTabLinkItemProvisioning({
  appRoot = "",
  createCliError,
  dryRun = false,
  touchedFiles = new Set()
} = {}) {
  const providerSource = await loadMainClientProviderSource({
    appRoot,
    createCliError
  });
  if (hasTabLinkItemTokenRegistration(providerSource)) {
    return;
  }

  await ensureTabLinkItemComponentFile({ appRoot, dryRun, touchedFiles });
  await ensureTabLinkItemProviderRegistration({
    appRoot,
    createCliError,
    dryRun,
    touchedFiles
  });
}

export {
  TAB_LINK_COMPONENT_TOKEN,
  ensureLocalMainTabLinkItemProvisioning
};
