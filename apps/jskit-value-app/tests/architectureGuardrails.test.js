import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const SERVER_DOMAIN_DIR = path.join(SERVER_DIR, "domain");
const ARCHITECTURE_SCAN_DIRS = [path.join(SERVER_DIR, "domain"), path.join(SERVER_DIR, "modules")];
const APP_SPECIFIC_SERVER_FEATURE_ALLOWLIST = Object.freeze([
  // Domain/business uniqueness is intentionally restricted to these app-local features.
  "deg2rad",
  "projects"
]);
const TEMPORARY_SERVER_LIB_IMPORT_ALLOWLIST = Object.freeze(["server/lib/appConfig.js"]);
const LEGACY_TRANSCRIPT_MODE_FILES = Object.freeze([
  "server/lib/aiTranscriptMode.js",
  "server/modules/ai/transcripts/mode.js"
]);
const IMPORT_GUARD_SCAN_DIRS = Object.freeze([
  path.join(ROOT_DIR, "server"),
  path.join(ROOT_DIR, "src"),
  path.join(ROOT_DIR, "shared"),
  path.join(ROOT_DIR, "tests"),
  path.join(ROOT_DIR, "bin")
]);
const FORBIDDEN_TRANSCRIPT_MODE_IMPORT_SEGMENTS = Object.freeze(["aiTranscriptMode.js", "ai/transcripts/mode.js"]);
const REALTIME_PUBLISHER_FILES = Object.freeze([
  "server/realtime/publishers/projectPublisher.js",
  "server/realtime/publishers/workspacePublisher.js",
  "server/realtime/publishers/chatPublisher.js"
]);
const FORBIDDEN_REALTIME_PUBLISH_HELPER_FUNCTIONS = Object.freeze([
  "normalizeHeaderValue",
  "resolvePublishMethod",
  "buildPublishRequestMeta",
  "warnPublishFailure",
  "publishSafely"
]);
const FORBIDDEN_REALTIME_EVENT_HELPER_FUNCTIONS = Object.freeze([
  "normalizePositiveIntegerOrNull",
  "normalizeStringOrNull",
  "normalizeEntityId",
  "normalizePositiveIntegerArray",
  "normalizeScopeKind",
  "normalizeStringifiedPositiveIntegerOrNull"
]);

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
        .filter((targetPath) =>
          ARCHITECTURE_SCAN_DIRS.some((scanRoot) => toPosixPath(targetPath).startsWith(toPosixPath(scanRoot)))
        );

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
  const libDirectories = listDirectoriesNamedLib(SERVER_DOMAIN_DIR).map((dirPath) =>
    toPosixPath(path.relative(ROOT_DIR, dirPath))
  );
  assert.deepEqual(libDirectories, []);
});

test("architecture guardrail: app-specific server feature allowlist only contains deg2rad and projects", () => {
  assert.deepEqual(APP_SPECIFIC_SERVER_FEATURE_ALLOWLIST, ["deg2rad", "projects"]);
});

test("architecture guardrail: legacy transcript mode modules are removed", () => {
  const existingLegacyFiles = LEGACY_TRANSCRIPT_MODE_FILES.filter((relativePath) =>
    existsSync(path.resolve(ROOT_DIR, relativePath))
  );
  assert.deepEqual(existingLegacyFiles, []);
});

test("architecture guardrail: no imports reference legacy transcript mode modules", () => {
  const violations = [];

  for (const scanDir of IMPORT_GUARD_SCAN_DIRS) {
    if (!existsSync(scanDir)) {
      continue;
    }

    const files = listFilesRecursive(scanDir, (filePath) => /\.(js|mjs|cjs)$/.test(filePath));
    for (const filePath of files) {
      const importSpecifiers = parseImportSpecifiers(filePath);
      for (const importSpecifier of importSpecifiers) {
        const normalizedSpecifier = toPosixPath(importSpecifier);
        if (
          FORBIDDEN_TRANSCRIPT_MODE_IMPORT_SEGMENTS.some((segment) => normalizedSpecifier.includes(segment))
        ) {
          violations.push({
            source: toPosixPath(path.relative(ROOT_DIR, filePath)),
            specifier: normalizedSpecifier
          });
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: imports from server/lib are limited to allowlisted transitional wrappers", () => {
  const violations = [];
  const allowlist = new Set(TEMPORARY_SERVER_LIB_IMPORT_ALLOWLIST);

  for (const scanDir of IMPORT_GUARD_SCAN_DIRS) {
    if (!existsSync(scanDir)) {
      continue;
    }

    const files = listFilesRecursive(scanDir, (filePath) => /\.(js|mjs|cjs)$/.test(filePath));
    for (const filePath of files) {
      const importSpecifiers = parseImportSpecifiers(filePath);
      for (const importSpecifier of importSpecifiers) {
        const resolvedImportPath = resolveRelativeImport(filePath, importSpecifier);
        if (!resolvedImportPath) {
          continue;
        }

        const relativeImportPath = toPosixPath(path.relative(ROOT_DIR, resolvedImportPath));
        if (!relativeImportPath.startsWith("server/lib/")) {
          continue;
        }

        if (!allowlist.has(relativeImportPath)) {
          violations.push({
            source: toPosixPath(path.relative(ROOT_DIR, filePath)),
            target: relativeImportPath
          });
        }
      }
    }
  }

  assert.deepEqual(violations, []);
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
    const importsOtherDomainService = /^server\/domain\/(?!realtime\/).+\/services\/.+\.service\.js$/.test(
      relativePath
    );

    if (importsModuleService || importsOtherDomainService) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: realtime publishers use shared realtime publish primitives", () => {
  const violations = [];

  for (const relativePath of REALTIME_PUBLISHER_FILES) {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    const source = readFileSync(absolutePath, "utf8");

    if (!source.includes("@jskit-ai/server-runtime-core/realtimePublish")) {
      violations.push(`${relativePath}:missing_shared_import`);
    }

    for (const functionName of FORBIDDEN_REALTIME_PUBLISH_HELPER_FUNCTIONS) {
      const functionPattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
      if (functionPattern.test(source)) {
        violations.push(`${relativePath}:redefined_${functionName}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture guardrail: app-local realtime publish helper shim is removed", () => {
  const sharedPublisherHelperPath = path.join(ROOT_DIR, "server/realtime/publishers/shared.js");
  assert.equal(existsSync(sharedPublisherHelperPath), false);
});

test("architecture guardrail: realtime events service uses shared realtime event primitives", () => {
  const realtimeServicePath = path.join(ROOT_DIR, "server/domain/realtime/services/events.service.js");
  const source = readFileSync(realtimeServicePath, "utf8");
  const violations = [];

  if (!source.includes("@jskit-ai/server-runtime-core/realtimeEvents")) {
    violations.push("missing_shared_realtime_events_import");
  }

  for (const functionName of FORBIDDEN_REALTIME_EVENT_HELPER_FUNCTIONS) {
    const functionPattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
    if (functionPattern.test(source)) {
      violations.push(`redefined_${functionName}`);
    }
  }

  assert.deepEqual(violations, []);
});
