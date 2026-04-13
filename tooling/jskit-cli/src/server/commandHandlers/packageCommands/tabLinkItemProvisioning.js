import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS,
  findLocalLinkItemDefinition,
  readLocalLinkItemComponentSource
} from "@jskit-ai/shell-web/server/support/localLinkItemScaffolds";

const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const PLACEMENT_FILE = "src/placement.js";
const PLACEMENT_COMPONENT_TOKEN_PATTERN = /\bcomponentToken\s*:\s*["']([^"']+)["']/g;
const TAB_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";

const LOCAL_LINK_ITEM_COMPONENT_TOKENS = Object.freeze(
  LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS.map((entry) => entry.token)
);

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
    throw new Error(`placement component provisioning could not find ${className} class declaration in ${contextFile || "target file"}.`);
  }

  return {
    changed: true,
    content: `${sourceText.slice(0, classMatch.index)}${normalizedLine}\n\n${sourceText.slice(classMatch.index)}`
  };
}

async function collectProvisionableLocalPlacementComponentTokensFromApp({
  appRoot = ""
} = {}) {
  const placementAbsolutePath = path.join(appRoot, PLACEMENT_FILE);
  const placementSource = await readUtf8FileIfExists(placementAbsolutePath);
  if (!placementSource) {
    return [];
  }

  const collectedTokens = new Set();
  for (const match of String(placementSource).matchAll(PLACEMENT_COMPONENT_TOKEN_PATTERN)) {
    const componentToken = String(match[1] || "").trim();
    if (!findLocalLinkItemDefinition(componentToken)) {
      continue;
    }
    collectedTokens.add(componentToken);
  }

  return Array.from(collectedTokens).sort((left, right) => left.localeCompare(right));
}

async function resolveProvisionableLocalPlacementComponentTokens({
  appRoot = "",
  componentTokens = []
} = {}) {
  const collectedTokens = new Set(
    (Array.isArray(componentTokens) ? componentTokens : [])
      .map((value) => String(value || "").trim())
      .filter((value) => Boolean(findLocalLinkItemDefinition(value)))
  );

  for (const componentToken of await collectProvisionableLocalPlacementComponentTokensFromApp({ appRoot })) {
    collectedTokens.add(componentToken);
  }

  return Array.from(collectedTokens).sort((left, right) => left.localeCompare(right));
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

async function ensureProvisionedComponentFile(
  definition,
  {
    appRoot = "",
    dryRun = false,
    touchedFiles = new Set()
  } = {}
) {
  const componentRelativePath = definition.componentFile;
  const componentAbsolutePath = path.join(appRoot, componentRelativePath);
  const existingComponentSource = await readUtf8FileIfExists(componentAbsolutePath);
  if (existingComponentSource) {
    return;
  }

    if (dryRun !== true) {
      await mkdir(path.dirname(componentAbsolutePath), { recursive: true });
      await writeFile(componentAbsolutePath, await readLocalLinkItemComponentSource(definition), "utf8");
    }
  touchedFiles.add(toPosixPath(componentRelativePath));
}

function hasProvisionedTokenRegistration(providerSource = "", componentToken = "") {
  const tokenPattern = String(componentToken || "").replaceAll(".", "\\.");
  const pattern = new RegExp(`registerMainClientComponent\\(\\s*"${tokenPattern}"\\s*,`, "m");
  return pattern.test(String(providerSource || ""));
}

async function loadMainClientProviderSource({ appRoot = "", createCliError, componentToken = "" } = {}) {
  const providerAbsolutePath = path.join(appRoot, MAIN_CLIENT_PROVIDER_FILE);
  let providerSource = "";
  try {
    providerSource = await readFile(providerAbsolutePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createCliError(
        `placement component token "${componentToken}" requires ${MAIN_CLIENT_PROVIDER_FILE}.`
      );
    }
    throw error;
  }

  if (!/\bregisterMainClientComponent\s*\(/.test(providerSource)) {
    throw createCliError(
      `placement component token "${componentToken}" could not find registerMainClientComponent() contract in ${MAIN_CLIENT_PROVIDER_FILE}.`
    );
  }

  return providerSource;
}

async function ensureProvisionedProviderRegistration(
  definition,
  {
    appRoot = "",
    createCliError,
    dryRun = false,
    touchedFiles = new Set()
  } = {}
) {
  const providerRelativePath = MAIN_CLIENT_PROVIDER_FILE;
  const providerAbsolutePath = path.join(appRoot, providerRelativePath);
  const providerSource = await loadMainClientProviderSource({
    appRoot,
    createCliError,
    componentToken: definition.token
  });
  if (hasProvisionedTokenRegistration(providerSource, definition.token)) {
    return false;
  }

  const importLine = `import ${definition.componentName} from "/${toPosixPath(definition.componentFile)}";`;
  const registerLine = `registerMainClientComponent("${definition.token}", () => ${definition.componentName});`;

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

async function ensureLocalMainPlacementComponentProvisioning({
  appRoot = "",
  createCliError,
  dryRun = false,
  touchedFiles = new Set(),
  componentTokens = []
} = {}) {
  const uniqueComponentTokens = Array.from(
    new Set(
      (Array.isArray(componentTokens) ? componentTokens : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  for (const componentToken of uniqueComponentTokens) {
    const definition = findLocalLinkItemDefinition(componentToken);
    if (!definition) {
      continue;
    }

    const providerSource = await loadMainClientProviderSource({
      appRoot,
      createCliError,
      componentToken: definition.token
    });
    if (hasProvisionedTokenRegistration(providerSource, definition.token)) {
      continue;
    }

    await ensureProvisionedComponentFile(definition, {
      appRoot,
      dryRun,
      touchedFiles
    });
    await ensureProvisionedProviderRegistration(definition, {
      appRoot,
      createCliError,
      dryRun,
      touchedFiles
    });
  }
}

async function ensureLocalMainTabLinkItemProvisioning({
  appRoot = "",
  createCliError,
  dryRun = false,
  touchedFiles = new Set()
} = {}) {
  return ensureLocalMainPlacementComponentProvisioning({
    appRoot,
    createCliError,
    dryRun,
    touchedFiles,
    componentTokens: [TAB_LINK_COMPONENT_TOKEN]
  });
}

export {
  LOCAL_LINK_ITEM_COMPONENT_TOKENS,
  TAB_LINK_COMPONENT_TOKEN,
  collectProvisionableLocalPlacementComponentTokensFromApp,
  resolveProvisionableLocalPlacementComponentTokens,
  ensureLocalMainPlacementComponentProvisioning,
  ensureLocalMainTabLinkItemProvisioning
};
