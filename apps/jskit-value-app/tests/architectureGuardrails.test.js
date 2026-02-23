import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const SERVER_DOMAIN_DIR = path.join(SERVER_DIR, "domain");
const ARCHITECTURE_SCAN_DIRS = [path.join(SERVER_DIR, "domain"), path.join(SERVER_DIR, "modules")];

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function listFilesRecursive(rootDir, filter = () => true) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && filter(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files;
}

function listDirectoriesNamedLib(rootDir) {
  const directories = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === "lib") {
        directories.push(absolutePath);
        continue;
      }
      walk(absolutePath);
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return directories;
}

function parseImportSpecifiers(filePath) {
  const source = readFileSync(filePath, "utf8");
  const specifiers = [];

  const importExportPattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function resolveRelativeImport(fromFilePath, importSpecifier) {
  if (!String(importSpecifier || "").startsWith(".")) {
    return null;
  }

  const resolvedBasePath = path.resolve(path.dirname(fromFilePath), importSpecifier);
  const candidatePaths = [
    resolvedBasePath,
    `${resolvedBasePath}.js`,
    `${resolvedBasePath}.mjs`,
    `${resolvedBasePath}.cjs`,
    path.join(resolvedBasePath, "index.js")
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
      return candidatePath;
    }
  }

  return null;
}

function classifyFeaturePath(filePath) {
  const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
  const match = relativePath.match(/^server\/(domain|modules)\/([^/]+)\//);
  if (!match) {
    return null;
  }

  return {
    layer: match[1],
    feature: match[2],
    relativePath
  };
}

function buildImportGraph() {
  const graph = new Map();

  for (const scanDir of ARCHITECTURE_SCAN_DIRS) {
    const files = listFilesRecursive(scanDir, (filePath) => /\.(js|mjs|cjs)$/.test(filePath));
    for (const filePath of files) {
      const resolvedImports = parseImportSpecifiers(filePath)
        .map((specifier) => resolveRelativeImport(filePath, specifier))
        .filter(Boolean)
        .filter((targetPath) => ARCHITECTURE_SCAN_DIRS.some((scanRoot) => toPosixPath(targetPath).startsWith(toPosixPath(scanRoot))));

      graph.set(filePath, resolvedImports);
    }
  }

  return graph;
}

function findCycle(graph) {
  const temporaryMarks = new Set();
  const permanentMarks = new Set();
  const stack = [];

  function visit(node) {
    if (permanentMarks.has(node)) {
      return null;
    }
    if (temporaryMarks.has(node)) {
      const cycleStartIndex = stack.indexOf(node);
      return stack.slice(cycleStartIndex).concat(node);
    }

    temporaryMarks.add(node);
    stack.push(node);

    const edges = graph.get(node) || [];
    for (const edge of edges) {
      const cycle = visit(edge);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    temporaryMarks.delete(node);
    permanentMarks.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

test("architecture guardrail: server/domain must not contain lib directories", () => {
  const libDirectories = listDirectoriesNamedLib(SERVER_DOMAIN_DIR).map((dirPath) => toPosixPath(path.relative(ROOT_DIR, dirPath)));
  assert.deepEqual(libDirectories, []);
});

test("architecture guardrail: service files avoid cross-feature imports across domain/module features", () => {
  const serviceFiles = listFilesRecursive(SERVER_DIR, (filePath) => toPosixPath(filePath).endsWith(".service.js"));
  const violations = [];

  for (const serviceFilePath of serviceFiles) {
    const sourceClassification = classifyFeaturePath(serviceFilePath);
    if (!sourceClassification) {
      continue;
    }

    const importSpecifiers = parseImportSpecifiers(serviceFilePath);
    for (const importSpecifier of importSpecifiers) {
      const resolvedImportPath = resolveRelativeImport(serviceFilePath, importSpecifier);
      if (!resolvedImportPath) {
        continue;
      }

      const targetClassification = classifyFeaturePath(resolvedImportPath);
      if (!targetClassification) {
        continue;
      }

      if (sourceClassification.feature === targetClassification.feature) {
        continue;
      }

      violations.push({
        source: sourceClassification.relativePath,
        target: targetClassification.relativePath
      });
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: server domain/modules import graph must be acyclic", () => {
  const importGraph = buildImportGraph();
  const cycle = findCycle(importGraph);

  if (!cycle) {
    assert.equal(cycle, null);
    return;
  }

  const cycleRelativePaths = cycle.map((absolutePath) => toPosixPath(path.relative(ROOT_DIR, absolutePath)));
  assert.fail(`Circular dependency detected: ${cycleRelativePaths.join(" -> ")}`);
});

test("architecture guardrail: realtime events service import hygiene forbids cross-feature services", () => {
  const realtimeServicePath = path.join(ROOT_DIR, "server/domain/realtime/services/events.service.js");
  const importSpecifiers = parseImportSpecifiers(realtimeServicePath);
  const violations = [];

  for (const importSpecifier of importSpecifiers) {
    const resolvedImportPath = resolveRelativeImport(realtimeServicePath, importSpecifier);
    if (!resolvedImportPath) {
      continue;
    }

    const relativePath = toPosixPath(path.relative(ROOT_DIR, resolvedImportPath));
    const importsModuleService = /^server\/modules\/.+\/service\.js$/.test(relativePath);
    const importsOtherDomainService =
      /^server\/domain\/(?!realtime\/).+\/services\/.+\.service\.js$/.test(relativePath);

    if (importsModuleService || importsOtherDomainService) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});
