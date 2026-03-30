import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  normalizeText,
  loadResourceDefinition,
  requireOperation,
  requireOutputSchema,
  requireBodySchema,
  requireObjectProperties,
  resolveListItemProperties,
  resolveLookupContainerKey,
  buildResourceFieldMetaMap,
  createFieldDefinitions,
  createFormFieldDefinitions,
  buildListHeaderColumns,
  buildListRowColumns,
  buildViewColumns,
  buildFormColumns,
  renderObjectPushLines
} from "../resourceSupport.js";

const SUPPORTED_OPERATIONS = new Set(["list", "view", "new", "edit"]);
const OPERATION_ALIASES = Object.freeze({
  create: "new",
  patch: "edit"
});

function toPosixPath(value = "") {
  return String(value || "").replaceAll(path.sep, "/");
}

function resolveOperation(rawOperation = "") {
  const normalized = normalizeText(rawOperation).toLowerCase();
  const resolved = OPERATION_ALIASES[normalized] || normalized;
  if (!SUPPORTED_OPERATIONS.has(resolved)) {
    throw new Error('crud-ui-generator field operation must be one of: list, view, new, edit.');
  }

  return resolved;
}

function resolveTargetFilePath(appRoot, targetFile) {
  const appRootAbsolute = path.resolve(String(appRoot || ""));
  if (!appRootAbsolute) {
    throw new Error("crud-ui-generator field requires appRoot.");
  }

  const normalizedTargetFile = normalizeText(targetFile);
  if (!normalizedTargetFile) {
    throw new Error("crud-ui-generator field requires target file path.");
  }

  const absolutePath = path.isAbsolute(normalizedTargetFile)
    ? path.resolve(normalizedTargetFile)
    : path.resolve(appRootAbsolute, normalizedTargetFile);
  const relativePath = path.relative(appRootAbsolute, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("crud-ui-generator field target file must stay within app root.");
  }

  return {
    absolutePath,
    relativePath
  };
}

function inferResourceOptionsFromSource(screenSource = "") {
  const source = String(screenSource || "");
  const importPattern = /import\s*\{\s*resource(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}\s*from\s*["']\/([^"']+)["'];?/g;
  let match = null;
  while ((match = importPattern.exec(source)) != null) {
    const alias = normalizeText(match[1]);
    const resourceFile = normalizeText(match[2]);
    if (!resourceFile) {
      continue;
    }
    if (alias && alias !== "uiResource") {
      continue;
    }

    return {
      "resource-file": resourceFile
    };
  }

  return {};
}

function resolveResourceOptions(options = {}, inferredOptions = {}) {
  const resourceFile = normalizeText(options?.["resource-file"] || inferredOptions?.["resource-file"]);
  if (!resourceFile) {
    throw new Error(
      'crud-ui-generator field could not resolve "resource-file". Pass --resource-file or run on a generated new/edit file that imports uiResource.'
    );
  }

  return {
    "resource-file": resourceFile
  };
}

function resolveOperationFields(resource, operationName) {
  const fieldMetaMap = buildResourceFieldMetaMap(resource);
  const lookupContainerKey = resolveLookupContainerKey(resource, {
    context: "crud-ui-generator field"
  });

  if (operationName === "list") {
    const listOperation = requireOperation(resource, "list", { context: "crud-ui-generator field" });
    const listOutputSchema = requireOutputSchema(listOperation, "list", { context: "crud-ui-generator field" });
    return createFieldDefinitions(
      resolveListItemProperties(listOutputSchema, { context: "crud-ui-generator field" }),
      { fieldMetaMap, lookupContainerKey }
    );
  }

  if (operationName === "view") {
    const viewOperation = requireOperation(resource, "view", { context: "crud-ui-generator field" });
    const viewOutputSchema = requireOutputSchema(viewOperation, "view", { context: "crud-ui-generator field" });
    return createFieldDefinitions(
      requireObjectProperties(viewOutputSchema, "operations.view output", { context: "crud-ui-generator field" }),
      { fieldMetaMap, lookupContainerKey }
    );
  }

  if (operationName === "new") {
    const createOperation = requireOperation(resource, "create", { context: "crud-ui-generator field" });
    const createBodySchema = requireBodySchema(createOperation, "create", { context: "crud-ui-generator field" });
    return createFormFieldDefinitions(
      requireObjectProperties(createBodySchema, "operations.create body", { context: "crud-ui-generator field" }),
      { fieldMetaMap, lookupContainerKey }
    );
  }

  const patchOperation = requireOperation(resource, "patch", { context: "crud-ui-generator field" });
  const patchBodySchema = requireBodySchema(patchOperation, "patch", { context: "crud-ui-generator field" });
  return createFormFieldDefinitions(
    requireObjectProperties(patchBodySchema, "operations.patch body", { context: "crud-ui-generator field" }),
    { fieldMetaMap, lookupContainerKey }
  );
}

function resolveFieldDefinition(fields = [], fieldKey = "") {
  const key = normalizeText(fieldKey);
  const field = (Array.isArray(fields) ? fields : []).find((entry) => normalizeText(entry?.key) === key) || null;
  if (field) {
    return field;
  }

  const available = (Array.isArray(fields) ? fields : [])
    .map((entry) => normalizeText(entry?.key))
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `crud-ui-generator field could not find field "${key}" in resource schema for selected operation. Available: ${available || "<none>"}.`
  );
}

function insertBeforeAnchor(source, { anchor = "", snippet = "" } = {}) {
  const normalizedAnchor = String(anchor || "");
  const normalizedSnippet = String(snippet || "").trimEnd();
  if (!normalizedAnchor || !normalizedSnippet) {
    return {
      content: source,
      changed: false
    };
  }

  if (String(source || "").includes(normalizedSnippet)) {
    return {
      content: source,
      changed: false
    };
  }

  const sourceText = String(source || "");
  const escapedAnchor = normalizedAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anchorLinePattern = new RegExp(`^([ \\t]*)${escapedAnchor}[ \\t]*$`, "m");
  const anchorLineMatch = sourceText.match(anchorLinePattern);
  if (!anchorLineMatch) {
    throw new Error(`crud-ui-generator field could not find anchor: ${normalizedAnchor}`);
  }
  const anchorIndent = String(anchorLineMatch[1] || "");
  const alignedAnchorLine = `${anchorIndent}${normalizedAnchor}`;

  return {
    content: sourceText.replace(anchorLinePattern, `${normalizedSnippet}\n${alignedAnchorLine}`),
    changed: true
  };
}

function buildAnchorInsertions(operationName, field) {
  if (operationName === "list") {
    return [
      {
        anchor: "<!-- jskit:crud-ui-fields:list-header -->",
        snippet: buildListHeaderColumns([field])
      },
      {
        anchor: "<!-- jskit:crud-ui-fields:list-row -->",
        snippet: buildListRowColumns([field])
      }
    ];
  }

  if (operationName === "view") {
    return [
      {
        anchor: "<!-- jskit:crud-ui-fields:view -->",
        snippet: buildViewColumns([field])
      }
    ];
  }

  if (operationName === "new") {
    return [
      {
        anchor: "<!-- jskit:crud-ui-fields:new -->",
        snippet: buildFormColumns([field])
      },
      {
        anchor: "// jskit:crud-ui-form-fields:new",
        snippet: renderObjectPushLines("UI_CREATE_FORM_FIELDS", [field])
      }
    ];
  }

  return [
    {
      anchor: "<!-- jskit:crud-ui-fields:edit -->",
      snippet: buildFormColumns([field])
    },
    {
      anchor: "// jskit:crud-ui-form-fields:edit",
      snippet: renderObjectPushLines("UI_EDIT_FORM_FIELDS", [field])
    }
  ];
}

function parseSubcommandArgs(args = []) {
  const source = Array.isArray(args) ? args : [];
  const fieldKey = normalizeText(source[0]);
  const operationName = resolveOperation(source[1]);
  const targetFile = normalizeText(source[2]);

  if (!fieldKey) {
    throw new Error("crud-ui-generator field requires <fieldKey>.");
  }
  if (!targetFile) {
    throw new Error("crud-ui-generator field requires <targetFile>.");
  }

  return {
    fieldKey,
    operationName,
    targetFile
  };
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "field") {
    throw new Error(`Unsupported crud-ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }

  const { fieldKey, operationName, targetFile } = parseSubcommandArgs(args);
  const { absolutePath: targetAbsolutePath, relativePath: targetRelativePath } = resolveTargetFilePath(appRoot, targetFile);

  const originalSource = await readFile(targetAbsolutePath, "utf8");
  const inferredResourceOptions = inferResourceOptionsFromSource(originalSource);
  const resourceOptions = resolveResourceOptions(options, inferredResourceOptions);
  const resource = await loadResourceDefinition({
    appRoot,
    options: resourceOptions,
    context: "crud-ui-generator field"
  });

  const fields = resolveOperationFields(resource, operationName);
  const field = resolveFieldDefinition(fields, fieldKey);
  const insertions = buildAnchorInsertions(operationName, field);

  let nextSource = originalSource;
  let changed = false;
  for (const insertion of insertions) {
    const applied = insertBeforeAnchor(nextSource, insertion);
    nextSource = applied.content;
    changed = changed || applied.changed;
  }

  if (changed && dryRun !== true) {
    await writeFile(targetAbsolutePath, nextSource, "utf8");
  }

  return {
    touchedFiles: changed ? [toPosixPath(targetRelativePath)] : [],
    summary: changed
      ? `Added field "${field.key}" to ${operationName} in ${toPosixPath(targetRelativePath)}.`
      : `Field "${field.key}" already exists in ${operationName} for ${toPosixPath(targetRelativePath)}.`
  };
}

export { runGeneratorSubcommand };
