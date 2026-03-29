import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/database-runtime/shared";
import { toCamelCase } from "@jskit-ai/kernel/shared/support/stringCase";
import {
  resolveGenerationSnapshot,
  resolveScaffoldColumns,
  renderPropertyAccess,
  renderResourceFieldSchema,
  renderInputNormalizer,
  renderOutputNormalizerExpression,
  buildFieldMetaEntries
} from "../buildTemplateContext.js";
import {
  resolveCrudResourceDefaults,
  applyCrudResourceFieldPatch
} from "./resourceAst.js";

const NORMALIZE_SUPPORT_IMPORTS = new Set([
  "normalizeText",
  "normalizeBoolean",
  "normalizeFiniteNumber",
  "normalizeFiniteInteger",
  "normalizeIfInSource",
  "normalizeIfPresent",
  "normalizeOrNull"
]);
const DATABASE_RUNTIME_IMPORTS = new Set(["toIsoString", "toDatabaseDateTimeUtc"]);
const DATABASE_RUNTIME_REPOSITORY_IMPORTS = new Set(["parseJsonValue"]);

function toPosixPath(value = "") {
  return String(value || "").replaceAll(path.sep, "/");
}

function resolveTargetFilePath(appRoot, targetFile) {
  const appRootAbsolute = path.resolve(String(appRoot || ""));
  if (!appRootAbsolute) {
    throw new Error("crud-server-generator add-field requires appRoot.");
  }

  const normalizedTargetFile = normalizeText(targetFile);
  if (!normalizedTargetFile) {
    throw new Error("crud-server-generator add-field requires target file path.");
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
    throw new Error("crud-server-generator add-field target file must stay within app root.");
  }

  return {
    absolutePath,
    relativePath
  };
}

function parseSubcommandArgs(args = []) {
  const source = Array.isArray(args) ? args : [];
  const fieldKey = toCamelCase(normalizeText(source[0]));
  const targetFile = normalizeText(source[1]);

  if (!fieldKey) {
    throw new Error("crud-server-generator add-field requires <fieldKey>.");
  }
  if (!targetFile) {
    throw new Error("crud-server-generator add-field requires <targetFile>.");
  }

  return {
    fieldKey,
    targetFile
  };
}

function resolveRequestedTableConfig(source = "", options = {}, context = "crud-server-generator add-field") {
  const defaults = resolveCrudResourceDefaults(source, context);
  const tableName = normalizeText(options?.["table-name"] || defaults.tableName);
  if (!tableName) {
    throw new Error(`${context} requires --table-name or resource tableName.`);
  }

  const idColumn = normalizeText(options?.["id-column"] || defaults.idColumn) || "id";
  return {
    tableName,
    idColumn
  };
}

function resolveColumnForField(snapshot = {}, fieldKey = "", { idColumn = "id" } = {}) {
  const key = toCamelCase(normalizeText(fieldKey));
  const scaffoldColumns = resolveScaffoldColumns({
    ...snapshot,
    idColumn
  });
  const column = scaffoldColumns.find((entry) => normalizeText(entry?.key) === key) || null;
  if (column) {
    return column;
  }

  const available = scaffoldColumns
    .map((column) => normalizeText(column?.key))
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `crud-server-generator add-field could not find field "${key}" in DB snapshot columns. Available: ${available || "<none>"}.`
  );
}

function buildFieldMetaEntry(snapshot = {}, column = {}) {
  const entries = buildFieldMetaEntries({
    outputColumns: [column],
    writableColumns: [column],
    snapshot
  });
  const key = normalizeText(column?.key);
  return entries.find((entry) => normalizeText(entry?.key) === key) || null;
}

function collectKnownIdentifiers(expression = "") {
  return new Set(String(expression || "").match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
}

function resolveImportsForField({ inputNormalizationExpression = "", outputNormalizationExpression = "" } = {}) {
  const normalizeImports = new Set(["normalizeIfInSource"]);
  const databaseRuntimeImports = new Set();
  const databaseRuntimeRepositoryImports = new Set();

  const identifiers = new Set([
    ...collectKnownIdentifiers(inputNormalizationExpression),
    ...collectKnownIdentifiers(outputNormalizationExpression)
  ]);

  for (const identifier of identifiers) {
    if (NORMALIZE_SUPPORT_IMPORTS.has(identifier)) {
      normalizeImports.add(identifier);
      continue;
    }
    if (DATABASE_RUNTIME_IMPORTS.has(identifier)) {
      databaseRuntimeImports.add(identifier);
      continue;
    }
    if (DATABASE_RUNTIME_REPOSITORY_IMPORTS.has(identifier)) {
      databaseRuntimeRepositoryImports.add(identifier);
    }
  }

  return {
    normalizeImports: [...normalizeImports],
    databaseRuntimeImports: [...databaseRuntimeImports],
    databaseRuntimeRepositoryImports: [...databaseRuntimeRepositoryImports]
  };
}

function resolveOutputNormalizationExpression(column = {}) {
  const outputNormalizer = renderOutputNormalizerExpression(column);
  const sourceAccess = renderPropertyAccess("source", column.key);
  if (!outputNormalizer) {
    return sourceAccess;
  }
  const wrapper = column?.nullable === true ? "normalizeOrNull" : "normalizeIfPresent";
  return `${wrapper}(${sourceAccess}, ${outputNormalizer})`;
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false,
  resolveSnapshot = resolveGenerationSnapshot
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "add-field") {
    throw new Error(`Unsupported crud-server-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }

  const { fieldKey, targetFile } = parseSubcommandArgs(args);
  const { absolutePath: targetAbsolutePath, relativePath: targetRelativePath } = resolveTargetFilePath(
    appRoot,
    targetFile
  );
  const originalSource = await readFile(targetAbsolutePath, "utf8");
  const { tableName, idColumn } = resolveRequestedTableConfig(originalSource, options);
  const snapshot = await resolveSnapshot({
    appRoot,
    tableName,
    idColumnOption: idColumn
  });
  const column = resolveColumnForField(snapshot, fieldKey, { idColumn });
  if (column?.writable !== true) {
    throw new Error(
      `crud-server-generator add-field cannot patch non-writable field "${fieldKey}" (column "${column.name}").`
    );
  }

  const createSchemaExpression = renderResourceFieldSchema(column, { forOutput: false });
  const outputSchemaExpression = renderResourceFieldSchema(column, { forOutput: true });
  const inputNormalizationExpression = renderInputNormalizer(column);
  const outputNormalizationExpression = resolveOutputNormalizationExpression(column);
  const fieldMetaEntry = buildFieldMetaEntry(snapshot, column);
  const imports = resolveImportsForField({
    inputNormalizationExpression,
    outputNormalizationExpression
  });

  const applied = applyCrudResourceFieldPatch(originalSource, {
    fieldKey,
    createSchemaExpression,
    outputSchemaExpression,
    inputNormalizationExpression,
    outputNormalizationExpression,
    fieldMetaEntry,
    normalizeImportNames: imports.normalizeImports,
    databaseRuntimeImportNames: imports.databaseRuntimeImports,
    databaseRuntimeRepositoryOptionsImportNames: imports.databaseRuntimeRepositoryImports
  });

  if (applied.changed && dryRun !== true) {
    await writeFile(targetAbsolutePath, applied.content, "utf8");
  }

  return {
    touchedFiles: applied.changed ? [toPosixPath(targetRelativePath)] : [],
    summary: applied.changed
      ? `Added field "${fieldKey}" to ${toPosixPath(targetRelativePath)}.`
      : `Field "${fieldKey}" already exists in ${toPosixPath(targetRelativePath)}.`
  };
}

export { runGeneratorSubcommand };
