import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  Project
} from "ts-morph";
import { fileExists } from "./shared.js";

const MAIN_CLIENT_PROVIDER_FILE = "packages/main/src/client/providers/MainClientProvider.js";
const CRUD_FORM_FIELD_ARRAY_NAMES = Object.freeze([
  "UI_CREATE_FORM_FIELDS",
  "UI_EDIT_FORM_FIELDS"
]);
const CRUD_FORM_FIELD_MARKERS_BY_ARRAY = Object.freeze({
  UI_CREATE_FORM_FIELDS: "// jskit:crud-ui-form-fields:new",
  UI_EDIT_FORM_FIELDS: "// jskit:crud-ui-form-fields:edit"
});
const SOURCE_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue"]);
const SOURCE_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".jskit",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);

function createSourceFile(sourceText = "") {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true
  });
  return project.createSourceFile("/MainClientProvider.js", String(sourceText || ""), { overwrite: true });
}

function readStringLiteralValue(node) {
  if (!node) {
    return "";
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return "";
}

function readRegisterMainClientComponentToken(statement) {
  if (!Node.isExpressionStatement(statement)) {
    return "";
  }
  const expression = statement.getExpression();
  if (!Node.isCallExpression(expression)) {
    return "";
  }
  if (expression.getExpression().getText() !== "registerMainClientComponent") {
    return "";
  }
  return readStringLiteralValue(expression.getArguments()[0]);
}

function buildMainClientProviderMigration(sourceText = "") {
  const sourceFile = createSourceFile(sourceText);
  const classDeclaration = sourceFile.getClass("MainClientProvider");
  if (!classDeclaration) {
    return {
      changed: false,
      content: sourceText,
      moved: 0,
      deduped: 0,
      reason: "missing-class"
    };
  }

  const classStart = classDeclaration.getStart();
  const registerRecords = sourceFile
    .getStatements()
    .map((statement, index) => ({
      statement,
      index,
      token: readRegisterMainClientComponentToken(statement),
      text: statement.getText(),
      beforeClass: statement.getStart() < classStart
    }))
    .filter((record) => record.token);

  const movedRecords = registerRecords.filter((record) => !record.beforeClass);
  const seenTokens = new Set();
  const desiredRecords = [];
  const duplicates = [];
  for (const record of [
    ...registerRecords.filter((entry) => entry.beforeClass),
    ...movedRecords
  ]) {
    if (seenTokens.has(record.token)) {
      duplicates.push(record);
      continue;
    }
    seenTokens.add(record.token);
    desiredRecords.push(record);
  }

  if (movedRecords.length < 1 && duplicates.length < 1) {
    return {
      changed: false,
      content: sourceText,
      moved: 0,
      deduped: 0,
      reason: "already-current"
    };
  }

  for (const record of [...registerRecords].sort((left, right) => right.index - left.index)) {
    record.statement.remove();
  }

  const nextClassIndex = sourceFile.getStatements().findIndex((statement) =>
    Node.isClassDeclaration(statement) && statement.getName() === "MainClientProvider"
  );
  if (nextClassIndex < 0) {
    return {
      changed: false,
      content: sourceText,
      moved: 0,
      deduped: 0,
      reason: "missing-class"
    };
  }

  sourceFile.insertStatements(nextClassIndex, desiredRecords.map((record) => record.text));
  return {
    changed: true,
    content: sourceFile.getFullText(),
    moved: movedRecords.length,
    deduped: duplicates.length,
    reason: "rewritten"
  };
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchingDelimiter(sourceText = "", openIndex = -1, openChar = "(", closeChar = ")") {
  const source = String(sourceText || "");
  if (openIndex < 0 || source[openIndex] !== openChar) {
    return -1;
  }

  let depth = 0;
  let quote = "";
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1] || "";
    const previousChar = source[index - 1] || "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (char === quote && previousChar !== "\\") {
        quote = "";
      }
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function readLineIndent(sourceText = "", index = 0) {
  const source = String(sourceText || "");
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const linePrefix = source.slice(lineStart, index);
  const match = linePrefix.match(/^[ \t]*/);
  return match?.[0] || "";
}

function readFormFieldKey(sourceText = "") {
  const match = String(sourceText || "").match(/(?:^|[,{]\s*)(?:"key"|key)\s*:\s*["']([^"']+)["']/);
  return String(match?.[1] || "");
}

function readFormFieldKeys(sourceText = "") {
  const keys = new Set();
  const keyPattern = /(?:^|[,{]\s*)(?:"key"|key)\s*:\s*["']([^"']+)["']/g;
  let match = null;
  while ((match = keyPattern.exec(String(sourceText || ""))) != null) {
    if (match[1]) {
      keys.add(String(match[1]));
    }
  }
  return keys;
}

function formatArrayEntry(entrySource = "", indent = "  ") {
  return String(entrySource || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function findFormFieldArrayDeclaration(sourceText = "", arrayName = "") {
  const source = String(sourceText || "");
  const declarationPattern = new RegExp(`\\b(?:const|let)\\s+${escapeRegExp(arrayName)}\\s*=\\s*\\[`, "g");
  const match = declarationPattern.exec(source);
  if (!match) {
    return null;
  }

  const openIndex = source.indexOf("[", match.index);
  const closeIndex = findMatchingDelimiter(source, openIndex, "[", "]");
  if (closeIndex < 0) {
    return null;
  }

  return {
    openIndex,
    closeIndex,
    indent: readLineIndent(source, match.index),
    content: source.slice(openIndex + 1, closeIndex)
  };
}

function findLineRangeContaining(sourceText = "", searchText = "", { afterIndex = -1 } = {}) {
  const source = String(sourceText || "");
  const target = String(searchText || "");
  if (!target) {
    return null;
  }

  const startSearchIndex = Number.isInteger(afterIndex) && afterIndex >= 0 ? afterIndex : 0;
  const matchIndex = source.indexOf(target, startSearchIndex);
  if (matchIndex < 0) {
    return null;
  }

  const lineStart = source.lastIndexOf("\n", Math.max(0, matchIndex - 1)) + 1;
  let lineEnd = source.indexOf("\n", matchIndex);
  if (lineEnd < 0) {
    lineEnd = source.length;
  } else {
    lineEnd += 1;
  }

  return {
    startIndex: lineStart,
    endIndex: lineEnd,
    text: source.slice(lineStart, lineEnd)
  };
}

function findFormFieldPushCalls(sourceText = "", arrayName = "") {
  const source = String(sourceText || "");
  const callPattern = new RegExp(`^[ \\t]*${escapeRegExp(arrayName)}\\.push\\s*\\(`, "gm");
  const calls = [];
  let match = null;
  while ((match = callPattern.exec(source)) != null) {
    const openIndex = source.indexOf("(", match.index);
    const closeIndex = findMatchingDelimiter(source, openIndex, "(", ")");
    if (closeIndex < 0) {
      continue;
    }

    let endIndex = closeIndex + 1;
    while (endIndex < source.length && /[ \t]/.test(source[endIndex])) {
      endIndex += 1;
    }
    if (source[endIndex] === ";") {
      endIndex += 1;
    }
    while (endIndex < source.length && /[ \t]/.test(source[endIndex])) {
      endIndex += 1;
    }
    if (source.slice(endIndex, endIndex + 2) === "\r\n") {
      endIndex += 2;
    } else if (source[endIndex] === "\n") {
      endIndex += 1;
    }

    const argumentSource = source.slice(openIndex + 1, closeIndex).trim();
    if (!argumentSource.startsWith("{") || !argumentSource.endsWith("}")) {
      continue;
    }

    calls.push({
      startIndex: match.index,
      endIndex,
      argumentSource,
      key: readFormFieldKey(argumentSource)
    });
  }

  return calls;
}

function buildArrayContentWithAddedEntries(existingContent = "", entries = [], indent = "", { marker = "" } = {}) {
  const entriesBlock = entries
    .map((entry) => formatArrayEntry(entry, `${indent}  `))
    .join(",\n");
  const markerLine = String(marker || "").trim() ? `${indent}  ${String(marker || "").trim()}` : "";
  const normalizedExistingContent = markerLine
    ? String(existingContent || "").replace(new RegExp(`^[ \\t]*${escapeRegExp(marker)}[ \\t]*\\r?\\n?`, "m"), "")
    : String(existingContent || "");
  if (!entriesBlock && !markerLine) {
    return normalizedExistingContent;
  }

  const trimmedExisting = normalizedExistingContent.trim();
  if (!trimmedExisting) {
    const lines = [entriesBlock, markerLine].filter(Boolean);
    return `\n${lines.join("\n")}\n${indent}`;
  }

  const existingWithoutTrailingWhitespace = normalizedExistingContent.trimEnd();
  const existingWithComma = existingWithoutTrailingWhitespace.endsWith(",")
    ? existingWithoutTrailingWhitespace
    : `${existingWithoutTrailingWhitespace},`;
  const appendedLines = [entriesBlock, markerLine].filter(Boolean).join("\n");
  return `${existingWithComma}\n${appendedLines}\n${indent}`;
}

function applyTextReplacements(sourceText = "", replacements = []) {
  let content = String(sourceText || "");
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    content = `${content.slice(0, replacement.start)}${replacement.text}${content.slice(replacement.end)}`;
  }
  return content;
}

function buildCrudFormFieldPushMigration(sourceText = "") {
  const source = String(sourceText || "");
  if (!source.includes("UI_")) {
    return {
      changed: false,
      content: source,
      folded: 0,
      movedMarkers: 0,
      reason: "no-form-field-pushes"
    };
  }

  const replacements = [];
  let folded = 0;
  let movedMarkers = 0;
  for (const arrayName of CRUD_FORM_FIELD_ARRAY_NAMES) {
    const declaration = findFormFieldArrayDeclaration(source, arrayName);
    const calls = findFormFieldPushCalls(source, arrayName);
    const marker = CRUD_FORM_FIELD_MARKERS_BY_ARRAY[arrayName] || "";
    const markerInArray = marker ? declaration?.content?.includes(marker) === true : true;
    const markerLineRange = marker && !markerInArray && declaration
      ? findLineRangeContaining(source, marker, { afterIndex: declaration.closeIndex })
      : null;
    if (!declaration || (calls.length < 1 && !markerLineRange)) {
      continue;
    }

    const knownKeys = readFormFieldKeys(declaration.content);
    const entriesToAdd = [];
    for (const call of calls) {
      const callKey = call.key;
      if (callKey && knownKeys.has(callKey)) {
        replacements.push({ start: call.startIndex, end: call.endIndex, text: "" });
        folded += 1;
        continue;
      }
      if (callKey) {
        knownKeys.add(callKey);
      }
      entriesToAdd.push(call.argumentSource);
      replacements.push({ start: call.startIndex, end: call.endIndex, text: "" });
      folded += 1;
    }

    if (markerLineRange) {
      replacements.push({ start: markerLineRange.startIndex, end: markerLineRange.endIndex, text: "" });
      movedMarkers += 1;
    }

    if (entriesToAdd.length > 0 || markerLineRange) {
      const shouldAddMarker = marker && !markerInArray;
      replacements.push({
        start: declaration.openIndex + 1,
        end: declaration.closeIndex,
        text: buildArrayContentWithAddedEntries(declaration.content, entriesToAdd, declaration.indent, {
          marker: shouldAddMarker ? marker : ""
        })
      });
    }
  }

  if (folded < 1 && movedMarkers < 1) {
    return {
      changed: false,
      content: source,
      folded: 0,
      movedMarkers: 0,
      reason: "no-foldable-form-field-pushes"
    };
  }

  return {
    changed: true,
    content: applyTextReplacements(source, replacements),
    folded,
    movedMarkers,
    reason: "rewritten"
  };
}

async function collectCrudFormFieldCandidateFiles(appRoot = "") {
  const pagesRoot = path.join(appRoot, "src", "pages");
  if (!(await fileExists(pagesRoot))) {
    return [];
  }

  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SOURCE_SCAN_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }
      files.push(absolutePath);
    }
  }

  await visit(pagesRoot);
  return files.sort();
}

async function runAppMigrateSourceMutationsCommand(_ctx = {}, { appRoot = "", options = {}, stdout }) {
  const dryRun = options?.dryRun === true;
  let changedCount = 0;
  const absolutePath = path.join(appRoot, MAIN_CLIENT_PROVIDER_FILE);
  if (await fileExists(absolutePath)) {
    const previousContent = await readFile(absolutePath, "utf8");
    const migrated = buildMainClientProviderMigration(previousContent);
    if (migrated.changed) {
      if (!dryRun) {
        await writeFile(absolutePath, migrated.content, "utf8");
      }

      changedCount += 1;
      const action = dryRun ? "would rewrite" : "rewrote";
      const movedSuffix = migrated.moved === 1 ? "1 component registration" : `${migrated.moved} component registrations`;
      const dedupeSuffix = migrated.deduped > 0
        ? ` and removed ${migrated.deduped} duplicate registration${migrated.deduped === 1 ? "" : "s"}`
        : "";
      stdout.write(
        `[migrate-source-mutations] ${action} ${MAIN_CLIENT_PROVIDER_FILE}: moved ${movedSuffix} before MainClientProvider${dedupeSuffix}.\n`
      );
    }
  }

  const crudFormFieldFiles = await collectCrudFormFieldCandidateFiles(appRoot);
  for (const filePath of crudFormFieldFiles) {
    const previousContent = await readFile(filePath, "utf8");
    const migrated = buildCrudFormFieldPushMigration(previousContent);
    if (!migrated.changed) {
      continue;
    }
    if (!dryRun) {
      await writeFile(filePath, migrated.content, "utf8");
    }

    changedCount += 1;
    const relativePath = path.relative(appRoot, filePath).replaceAll(path.sep, "/");
    const action = dryRun ? "would rewrite" : "rewrote";
    const foldedSuffix = migrated.folded === 1 ? "1 form field push" : `${migrated.folded} form field pushes`;
    const markerSuffix = migrated.movedMarkers > 0
      ? ` and moved ${migrated.movedMarkers} form-field marker${migrated.movedMarkers === 1 ? "" : "s"} into array literals`
      : "";
    stdout.write(
      `[migrate-source-mutations] ${action} ${relativePath}: folded ${foldedSuffix} into array literals${markerSuffix}.\n`
    );
  }

  if (changedCount < 1) {
    stdout.write("[migrate-source-mutations] source files are already current.\n");
  }

  return 0;
}

export {
  buildCrudFormFieldPushMigration,
  buildMainClientProviderMigration,
  runAppMigrateSourceMutationsCommand
};
