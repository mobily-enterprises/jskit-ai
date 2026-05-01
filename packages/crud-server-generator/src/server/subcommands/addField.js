import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { normalizeText } from "@jskit-ai/database-runtime/shared";
import { toCamelCase } from "@jskit-ai/kernel/shared/support/stringCase";
import {
  resolveGenerationSnapshot,
  resolveScaffoldColumns,
  renderCanonicalResourceFieldSchema,
  buildFieldContractEntries
} from "../buildTemplateContext.js";
import {
  resolveCrudResourceDefaults,
  applyCrudResourceFieldPatch
} from "./resourceAst.js";

function toPosixPath(value = "") {
  return String(value || "").replaceAll(path.sep, "/");
}

function resolveTargetFilePath(appRoot, targetFile) {
  const appRootAbsolute = path.resolve(String(appRoot || ""));
  if (!appRootAbsolute) {
    throw new Error("crud-server-generator scaffold-field requires appRoot.");
  }

  const normalizedTargetFile = normalizeText(targetFile);
  if (!normalizedTargetFile) {
    throw new Error("crud-server-generator scaffold-field requires target file path.");
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
    throw new Error("crud-server-generator scaffold-field target file must stay within app root.");
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
    throw new Error("crud-server-generator scaffold-field requires <fieldKey>.");
  }
  if (!targetFile) {
    throw new Error("crud-server-generator scaffold-field requires <targetFile>.");
  }

  return {
    fieldKey,
    targetFile
  };
}

function resolveRequestedTableConfig(source = "", options = {}, context = "crud-server-generator scaffold-field") {
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
    `crud-server-generator scaffold-field could not find field "${key}" in DB snapshot columns. Available: ${available || "<none>"}.`
  );
}

function buildFieldContractEntry(snapshot = {}, column = {}) {
  const entries = buildFieldContractEntries({
    outputColumns: [column],
    writableColumns: [column],
    snapshot
  });
  const key = normalizeText(column?.key);
  return entries.find((entry) => normalizeText(entry?.key) === key) || null;
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
  if (normalizedSubcommand !== "scaffold-field") {
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
      `crud-server-generator scaffold-field cannot patch non-writable field "${fieldKey}" (column "${column.name}").`
    );
  }

  const fieldContractEntry = buildFieldContractEntry(snapshot, column);
  const resourceSchemaExpression = renderCanonicalResourceFieldSchema(column, {
    fieldContractEntry
  });

  const applied = applyCrudResourceFieldPatch(originalSource, {
    fieldKey,
    resourceSchemaExpression
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
