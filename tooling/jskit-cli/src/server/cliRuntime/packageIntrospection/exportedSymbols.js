import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import { fileExists } from "../ioAndMigrations.js";
import { normalizeRelativePosixPath } from "../localPackageSupport.js";

function parseNamedExportSpecifiers(specifierSource) {
  const source = String(specifierSource || "");
  return source
    .split(",")
    .map((entry) => entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/g, "").trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+/g, " "))
    .map((entry) => {
      const aliasMatch = /^(.+?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(entry);
      if (aliasMatch) {
        return aliasMatch[2];
      }
      return entry;
    })
    .filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry));
}

function parseExportedSymbolsFromSource(source) {
  const text = String(source || "");
  const symbols = new Set();
  const starReExports = new Set();
  const namedReExports = new Set();

  const namespaceStarPattern = /export\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["']\s*;?/g;
  let match = namespaceStarPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    starReExports.add(String(match[2] || "").trim());
    match = namespaceStarPattern.exec(text);
  }

  const starPattern = /export\s+\*\s+from\s+["']([^"']+)["']\s*;?/g;
  match = starPattern.exec(text);
  while (match) {
    starReExports.add(String(match[1] || "").trim());
    match = starPattern.exec(text);
  }

  const namedPattern = /export\s*\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?\s*;?/g;
  match = namedPattern.exec(text);
  while (match) {
    const listSource = String(match[1] || "");
    for (const symbol of parseNamedExportSpecifiers(listSource)) {
      symbols.add(symbol);
    }
    if (match[2]) {
      namedReExports.add(String(match[2] || "").trim());
    }
    match = namedPattern.exec(text);
  }

  const functionPattern = /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  match = functionPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    match = functionPattern.exec(text);
  }

  const classPattern = /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  match = classPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    match = classPattern.exec(text);
  }

  const variablePattern = /export\s+(?:const|let|var)\s+([\s\S]*?);/g;
  match = variablePattern.exec(text);
  while (match) {
    const declaration = String(match[1] || "");
    const names = declaration.split(",").map((entry) => String(entry || "").trim());
    for (const name of names) {
      const declarationMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)\b/.exec(name);
      if (declarationMatch) {
        symbols.add(String(declarationMatch[1] || "").trim());
      }
    }
    match = variablePattern.exec(text);
  }

  const hasDefaultExport = /\bexport\s+default\b/.test(text);
  return {
    symbols: sortStrings([...symbols]),
    starReExports: sortStrings([...starReExports]),
    namedReExports: sortStrings([...namedReExports]),
    hasDefaultExport
  };
}

function classifyExportedSymbols(symbols = []) {
  const source = ensureArray(symbols).map((value) => String(value || "").trim()).filter(Boolean);
  const providers = [];
  const constants = [];
  const functions = [];
  const classesOrTypes = [];
  const internals = [];
  const others = [];

  for (const symbol of source) {
    if (/Provider$/.test(symbol)) {
      providers.push(symbol);
      continue;
    }
    if (/^__/.test(symbol)) {
      internals.push(symbol);
      continue;
    }
    if (/^[A-Z0-9_]+$/.test(symbol)) {
      constants.push(symbol);
      continue;
    }
    if (/^[a-z]/.test(symbol)) {
      functions.push(symbol);
      continue;
    }
    if (/^[A-Z]/.test(symbol)) {
      classesOrTypes.push(symbol);
      continue;
    }
    others.push(symbol);
  }

  return {
    providers: sortStrings(providers),
    constants: sortStrings(constants),
    functions: sortStrings(functions),
    classesOrTypes: sortStrings(classesOrTypes),
    internals: sortStrings(internals),
    others: sortStrings(others)
  };
}

async function collectExportFileSymbolSummaries({ packageRoot, packageExports, notes }) {
  const rootDir = String(packageRoot || "").trim();
  if (!rootDir) {
    return [];
  }

  const exportTargets = new Map();
  for (const entry of ensureArray(packageExports)) {
    const record = ensureObject(entry);
    if (record.targetType !== "file" || record.targetExists !== true) {
      continue;
    }

    const target = String(record.target || "").trim();
    if (!target.startsWith("./")) {
      continue;
    }
    const normalizedTarget = normalizeRelativePosixPath(target.replace(/^\.\//, ""));
    const basename = path.posix.basename(normalizedTarget);
    if (!/\.(?:js|mjs|cjs)$/i.test(basename)) {
      continue;
    }

    if (!exportTargets.has(normalizedTarget)) {
      exportTargets.set(normalizedTarget, {
        file: normalizedTarget,
        subpaths: new Set(),
        conditions: new Set()
      });
    }
    const bucket = exportTargets.get(normalizedTarget);
    bucket.subpaths.add(String(record.subpath || ".").trim() || ".");
    const condition = String(record.condition || "default").trim() || "default";
    if (condition !== "default") {
      bucket.conditions.add(condition);
    }
  }

  const summaries = [];
  for (const [relativeTargetPath, bucket] of exportTargets.entries()) {
    const absoluteTargetPath = path.resolve(rootDir, relativeTargetPath);
    if (!(await fileExists(absoluteTargetPath))) {
      ensureArray(notes).push(`Export file missing: ${relativeTargetPath}`);
      continue;
    }

    let source = "";
    try {
      source = await readFile(absoluteTargetPath, "utf8");
    } catch (error) {
      ensureArray(notes).push(
        `Failed to read export file ${relativeTargetPath}: ${String(error?.message || error || "unknown error")}`
      );
      continue;
    }

    const summary = parseExportedSymbolsFromSource(source);
    summaries.push({
      file: normalizeRelativePosixPath(relativeTargetPath),
      subpaths: sortStrings([...bucket.subpaths]),
      conditions: sortStrings([...bucket.conditions]),
      symbols: ensureArray(summary.symbols),
      hasDefaultExport: Boolean(summary.hasDefaultExport),
      starReExports: ensureArray(summary.starReExports),
      namedReExports: ensureArray(summary.namedReExports)
    });
  }

  return summaries.sort((left, right) => String(left.file || "").localeCompare(String(right.file || "")));
}

export {
  classifyExportedSymbols,
  collectExportFileSymbolSummaries
};
