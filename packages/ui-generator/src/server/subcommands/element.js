import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  resolveRequiredAppRoot,
  resolveShellOutletPlacementTargetFromApp,
  toPosixPath
} from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toCamelCase, toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_COMPONENT_DIRECTORY = "src/components";
const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const PLACEMENT_FILE = "src/placement.js";

function toKebabCase(value = "") {
  return toSnakeCase(value).replaceAll("_", "-");
}

function toPascalCase(value = "") {
  const camel = toCamelCase(toSnakeCase(value));
  if (!camel) {
    return "";
  }

  return `${camel.slice(0, 1).toUpperCase()}${camel.slice(1)}`;
}

function requireOption(options = {}, optionName = "") {
  const optionValue = normalizeText(options[optionName]);
  if (!optionValue) {
    throw new Error(`ui-generator element requires --${optionName}.`);
  }

  return optionValue;
}

function resolvePathWithinApp(appRoot, targetPath) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "ui-generator element"
  });

  const normalizedTargetPath = normalizeText(targetPath);
  if (!normalizedTargetPath) {
    throw new Error("ui-generator element requires target path.");
  }

  const absolutePath = path.resolve(resolvedAppRoot, normalizedTargetPath);
  const relativePath = path.relative(resolvedAppRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`ui-generator element target path must stay within app root: ${normalizedTargetPath}`);
  }

  return Object.freeze({
    absolutePath,
    relativePath: toPosixPath(relativePath)
  });
}

function ensureTrailingNewline(value = "") {
  const source = String(value || "");
  return source.endsWith("\n") ? source : `${source}\n`;
}

function appendBlockIfMarkerMissing(source = "", marker = "", block = "") {
  const normalizedMarker = String(marker || "").trim();
  const normalizedBlock = String(block || "").trim();
  if (!normalizedMarker || !normalizedBlock) {
    return {
      changed: false,
      content: String(source || "")
    };
  }

  const sourceText = String(source || "");
  if (sourceText.includes(normalizedMarker)) {
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

function insertProviderImportIfMissing(source = "", importLine = "") {
  const normalizedImportLine = String(importLine || "").trim();
  if (!normalizedImportLine) {
    return {
      changed: false,
      content: String(source || "")
    };
  }

  const sourceText = String(source || "");
  if (sourceText.includes(normalizedImportLine)) {
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

function insertBeforeMainClientProviderClass(source = "", line = "") {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return {
      changed: false,
      content: String(source || "")
    };
  }

  const sourceText = String(source || "");
  if (sourceText.includes(normalizedLine)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const classPattern = /^class\s+MainClientProvider\b/m;
  const classMatch = classPattern.exec(sourceText);
  if (!classMatch) {
    throw new Error(
      `ui-generator element could not find MainClientProvider class declaration in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const insertionIndex = classMatch.index;
  return {
    changed: true,
    content: `${sourceText.slice(0, insertionIndex)}${normalizedLine}\n\n${sourceText.slice(insertionIndex)}`
  };
}

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
  if (normalizedSubcommand !== "element") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  if (Array.isArray(args) && args.length > 0) {
    throw new Error("ui-generator element does not accept positional arguments.");
  }

  const name = requireOption(options, "name");
  const surface = requireOption(options, "surface").toLowerCase();
  const componentDirectory = normalizeText(options.path) || DEFAULT_COMPONENT_DIRECTORY;
  const elementNamePascal = toPascalCase(name);
  const elementNameKebab = toKebabCase(name);

  if (!elementNamePascal || !elementNameKebab) {
    throw new Error("ui-generator element requires a valid --name.");
  }

  const componentPath = resolvePathWithinApp(appRoot, path.join(componentDirectory, `${elementNamePascal}Element.vue`));
  const providerPath = resolvePathWithinApp(appRoot, MAIN_CLIENT_PROVIDER_FILE);
  const placementPath = resolvePathWithinApp(appRoot, PLACEMENT_FILE);
  const componentToken = `local.main.ui.element.${elementNameKebab}`;
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "ui-generator",
    placement: options?.placement
  });

  const touchedFiles = new Set();

  let componentSource = "";
  try {
    componentSource = await readFile(componentPath.absolutePath, "utf8");
  } catch {
    componentSource = "";
  }
  if (!componentSource) {
    if (dryRun !== true) {
      await mkdir(path.dirname(componentPath.absolutePath), { recursive: true });
      await writeFile(componentPath.absolutePath, renderElementComponentSource(name), "utf8");
    }
    touchedFiles.add(componentPath.relativePath);
  }

  const providerSource = await readFile(providerPath.absolutePath, "utf8");
  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw new Error(
      `ui-generator element could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  const componentImportLine =
    `import ${elementNamePascal}Element from "/${toPosixPath(path.join(componentDirectory, `${elementNamePascal}Element.vue`))}";`;
  const componentRegisterLine =
    `registerMainClientComponent("${componentToken}", () => ${elementNamePascal}Element);`;

  const providerImportApplied = insertProviderImportIfMissing(providerSource, componentImportLine);
  const providerRegisterApplied = insertBeforeMainClientProviderClass(
    providerImportApplied.content,
    componentRegisterLine
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
        ? `Generated UI element "${elementNameKebab}" and placement token "${componentToken}".`
        : `UI element "${elementNameKebab}" is already up to date.`
  };
}

export { runGeneratorSubcommand };
