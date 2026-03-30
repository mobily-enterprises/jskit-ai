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
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const PLACEMENT_FILE = "src/placement.js";
const CONTAINER_OUTLET_POSITION = "sub-pages";

function toKebabCase(value = "") {
  return toSnakeCase(value).replaceAll("_", "-");
}

function requireOption(options = {}, optionName = "", { context = "ui-generator container" } = {}) {
  const optionValue = normalizeText(options?.[optionName]);
  if (!optionValue) {
    throw new Error(`${context} requires --${optionName}.`);
  }

  return optionValue;
}

function ensureTrailingNewline(value = "") {
  const source = String(value || "");
  return source.endsWith("\n") ? source : `${source}\n`;
}

function appendBlockIfMarkerMissing(source = "", marker = "", block = "") {
  const normalizedMarker = String(marker || "").trim();
  const normalizedBlock = String(block || "").trim();
  const sourceText = String(source || "");
  if (!normalizedMarker || !normalizedBlock || sourceText.includes(normalizedMarker)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  return {
    changed: true,
    content: `${ensureTrailingNewline(sourceText)}${normalizedBlock}\n`
  };
}

function normalizeRoutePrefix(value = "") {
  const source = normalizeText(value).replaceAll("\\", "/");
  if (!source) {
    return "";
  }

  const parts = source
    .split("/")
    .map((entry) => toKebabCase(entry))
    .filter(Boolean);
  return parts.join("/");
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

function renderContainerPageSource({
  surface = "",
  title = "",
  containerHost = "",
  containerPosition = CONTAINER_OUTLET_POSITION
} = {}) {
  return `<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="px-0">${title}</v-card-title>
        <v-card-subtitle class="px-0">Manage ${toKebabCase(title)} modules.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pa-0">
        <v-list density="comfortable">
          <ShellOutlet host="${containerHost}" position="${containerPosition}" />
        </v-list>
      </v-card-text>
    </v-card>

    <RouterView />
  </section>
</template>

<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "${surface}"
    }
  }
}
</route>
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
  const name = requireOption(options, "name");
  const surface = requireOption(options, "surface").toLowerCase();
  const routePrefix = normalizeRoutePrefix(options?.["directory-prefix"]);
  const containerSlug = toKebabCase(name);
  if (!containerSlug) {
    throw new Error("ui-generator container requires a valid --name.");
  }

  const routePath = routePrefix ? `${routePrefix}/${containerSlug}` : containerSlug;
  const pagesDirectory = await resolveSurfacePagesDirectory(resolvedAppRoot, surface);
  const containerFilePath = path.join(pagesDirectory, `${routePath}.vue`);
  const containerRelativePath = toPosixPath(path.relative(resolvedAppRoot, containerFilePath));
  const placementPath = path.join(resolvedAppRoot, PLACEMENT_FILE);
  const placementRelativePath = toPosixPath(path.relative(resolvedAppRoot, placementPath));
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot: resolvedAppRoot,
    context: "ui-generator container",
    placement: options?.placement
  });

  const touchedFiles = new Set();

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
          containerHost: containerSlug
        }),
        "utf8"
      );
    }
    touchedFiles.add(containerRelativePath);
  }

  const placementSource = await readFile(placementPath, "utf8");
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
      await writeFile(placementPath, placementApplied.content, "utf8");
    }
    touchedFiles.add(placementRelativePath);
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
