import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  resolveShellOutletPlacementTargetFromApp,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import { normalizeBoolean, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  MAIN_CLIENT_PROVIDER_FILE,
  PLACEMENT_FILE,
  toKebabCase,
  toPascalCase,
  requireOption,
  rejectUnexpectedOptions,
  resolvePathWithinApp,
  appendBlockIfMarkerMissing,
  insertImportIfMissing,
  insertBeforeClassDeclaration
} from "./support.js";

const DEFAULT_ELEMENT_PLACEMENT = "shell-layout:top-right";

function renderElementComponentSource(elementName = "") {
  return `<template>
  <section class="pa-4">
    <h2 class="text-h6 mb-2">${elementName}</h2>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your UI element implementation.</p>
  </section>
</template>
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
  if (normalizedSubcommand !== "placed-element") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  if (Array.isArray(args) && args.length > 0) {
    throw new Error("ui-generator placed-element does not accept positional arguments.");
  }
  rejectUnexpectedOptions(options, ["name", "surface", "path", "placement", "force"], {
    context: "ui-generator placed-element"
  });

  const name = requireOption(options, "name", { context: "ui-generator placed-element" });
  const surface = requireOption(options, "surface", { context: "ui-generator placed-element" }).toLowerCase();
  const componentDirectory = normalizeText(options.path) || DEFAULT_COMPONENT_DIRECTORY;
  const forceOverwrite = Object.prototype.hasOwnProperty.call(options, "force")
    ? normalizeBoolean(options.force)
    : false;
  const elementNamePascal = toPascalCase(name);
  const elementNameKebab = toKebabCase(name);

  if (!elementNamePascal || !elementNameKebab) {
    throw new Error("ui-generator placed-element requires a valid --name.");
  }

  const componentPath = resolvePathWithinApp(appRoot, path.join(componentDirectory, `${elementNamePascal}Element.vue`), {
    context: "ui-generator placed-element"
  });
  const providerPath = resolvePathWithinApp(appRoot, MAIN_CLIENT_PROVIDER_FILE, {
    context: "ui-generator placed-element"
  });
  const placementPath = resolvePathWithinApp(appRoot, PLACEMENT_FILE, {
    context: "ui-generator placed-element"
  });
  const componentToken = `local.main.ui.element.${elementNameKebab}`;
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "ui-generator",
    placement: options?.placement || DEFAULT_ELEMENT_PLACEMENT
  });

  const touchedFiles = new Set();
  const desiredComponentSource = renderElementComponentSource(name);

  let componentSource = "";
  try {
    componentSource = await readFile(componentPath.absolutePath, "utf8");
  } catch {
    componentSource = "";
  }
  if (componentSource && !forceOverwrite) {
    throw new Error(
      `ui-generator placed-element will not overwrite existing component file ${componentPath.relativePath}. Re-run with --force to overwrite it.`
    );
  }
  if (!componentSource || (forceOverwrite && componentSource !== desiredComponentSource)) {
    if (dryRun !== true) {
      await mkdir(path.dirname(componentPath.absolutePath), { recursive: true });
      await writeFile(componentPath.absolutePath, desiredComponentSource, "utf8");
    }
    touchedFiles.add(componentPath.relativePath);
  }

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator placed-element could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const componentImportLine =
    `import ${elementNamePascal}Element from "/${toPosixPath(path.join(componentDirectory, `${elementNamePascal}Element.vue`))}";`;
  const componentRegisterLine =
    `registerMainClientComponent("${componentToken}", () => ${elementNamePascal}Element);`;

  const providerImportApplied = insertImportIfMissing(providerSource, componentImportLine);
  const providerRegisterApplied = insertBeforeClassDeclaration(
    providerImportApplied.content,
    componentRegisterLine,
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

  const placementSource = await readFile(placementPath.absolutePath, "utf8");
  const placementMarker = `jskit:ui-generator.element:${surface}:${elementNameKebab}`;
  const placementBlock =
    `// ${placementMarker}\n` +
    "{\n" +
    "  addPlacement({\n" +
    `    id: "ui-generator.element.${elementNameKebab}",\n` +
    `    host: "${placementTarget.host}",\n` +
    `    position: "${placementTarget.position}",\n` +
    `    surfaces: ["${surface}"],\n` +
    "    order: 155,\n" +
    `    componentToken: "${componentToken}"\n` +
    "  });\n" +
    "}\n";
  const placementApplied = appendBlockIfMarkerMissing(placementSource, placementMarker, placementBlock);
  if (placementApplied.changed) {
    if (dryRun !== true) {
      await writeFile(placementPath.absolutePath, placementApplied.content, "utf8");
    }
    touchedFiles.add(placementPath.relativePath);
  }

  const touchedFileList = [...touchedFiles].sort((left, right) => left.localeCompare(right));
  return {
    touchedFiles: touchedFileList,
    summary:
      touchedFileList.length > 0
        ? `Generated placed UI element "${elementNameKebab}" and placement token "${componentToken}".`
        : `Placed UI element "${elementNameKebab}" is already up to date.`
  };
}

export { runGeneratorSubcommand };
