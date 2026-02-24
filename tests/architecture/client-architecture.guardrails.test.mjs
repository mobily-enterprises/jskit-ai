import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const APPS_DIR = path.join(ROOT_DIR, "apps");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const CLIENT_ELEMENT_PACKAGE_SEGMENTS = Object.freeze([
  "packages/ai-agent/assistant-client-element/",
  "packages/chat/chat-client-element/",
  "packages/billing/billing-plan-client-element/",
  "packages/users/profile-client-element/"
]);

const STYLE_IMPORT_PATTERN = /\.(css|scss|sass|less|styl|stylus)(?:$|\?)/i;
const FORBIDDEN_VISUAL_IMPORT_PATTERNS = [
  /^vuetify(?:\/|$)/,
  /^@mdi\//,
  /^@fortawesome\//,
  /^@heroicons\//,
  /^@chakra-ui\//,
  /^@mui\//,
  /^antd(?:\/|$)/
];
const PASS_THROUGH_WRAPPER_ALLOWLIST = Object.freeze({});

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function listFilesRecursive(rootDir, predicate = () => true) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (predicate(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function listPackageJsFiles() {
  return listFilesRecursive(PACKAGES_DIR, (absolutePath) => JS_EXTENSIONS.has(path.extname(absolutePath)));
}

function listAppSourceJsFiles() {
  return listFilesRecursive(APPS_DIR, (absolutePath) => {
    if (!absolutePath.includes(`${path.sep}src${path.sep}`)) {
      return false;
    }
    return JS_EXTENSIONS.has(path.extname(absolutePath));
  });
}

function listAppBoundaryJsFiles() {
  return listFilesRecursive(APPS_DIR, (absolutePath) => {
    const isJsFile = JS_EXTENSIONS.has(path.extname(absolutePath));
    if (!isJsFile) {
      return false;
    }

    return (
      absolutePath.includes(`${path.sep}src${path.sep}`) ||
      absolutePath.includes(`${path.sep}server${path.sep}`) ||
      absolutePath.includes(`${path.sep}shared${path.sep}`)
    );
  });
}

function listPackageIndexFiles() {
  return listFilesRecursive(PACKAGES_DIR, (absolutePath) => {
    return absolutePath.endsWith(`${path.sep}src${path.sep}index.js`);
  });
}

function parseImportSpecifiers(sourceText) {
  const specifiers = [];
  const importExportPattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of sourceText.matchAll(importExportPattern)) {
    specifiers.push(String(match[1] || ""));
  }

  for (const match of sourceText.matchAll(dynamicImportPattern)) {
    specifiers.push(String(match[1] || ""));
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
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function isPassThroughWrapper(sourceText) {
  const withoutComments = String(sourceText || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const compact = withoutComments.trim();
  if (!compact) {
    return false;
  }

  const containsReExport = /\bexport\s+(?:\{[\s\S]*?\}\s+from|(?:\*)\s+from)\s+["'][^"']+["'];?/m.test(compact);
  if (!containsReExport) {
    return false;
  }

  const withoutReExports = compact
    .replace(/\bexport\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?/g, "")
    .replace(/\bexport\s+\*\s+from\s+["'][^"']+["'];?/g, "")
    .trim();

  return withoutReExports.length < 1;
}

test("client architecture guardrail: no configure*Runtime globals in production source", () => {
  const violations = [];
  const candidateFiles = [...listPackageJsFiles(), ...listAppSourceJsFiles()];

  for (const filePath of candidateFiles) {
    const source = readFileSync(filePath, "utf8");
    if (/\bconfigureAssistantRuntime\b|\bconfigureChatRuntime\b/.test(source)) {
      violations.push(toPosixPath(path.relative(ROOT_DIR, filePath)));
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: package index files forbid wildcard exports", () => {
  const violations = [];

  for (const indexFilePath of listPackageIndexFiles()) {
    const source = readFileSync(indexFilePath, "utf8");
    if (/^\s*export\s+\*\s+/m.test(source)) {
      violations.push(toPosixPath(path.relative(ROOT_DIR, indexFilePath)));
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: only client-element packages may contain Vue SFC files", () => {
  const violations = [];
  const vueFiles = listFilesRecursive(PACKAGES_DIR, (absolutePath) => absolutePath.endsWith(".vue")).map((filePath) =>
    toPosixPath(path.relative(ROOT_DIR, filePath))
  );

  for (const relativePath of vueFiles) {
    const normalizedPath = `${relativePath}/`;
    const isClientElementFile = CLIENT_ELEMENT_PACKAGE_SEGMENTS.some((segment) => normalizedPath.startsWith(segment));
    if (!isClientElementFile) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: packages do not import style assets", () => {
  const violations = [];

  for (const filePath of listPackageJsFiles()) {
    const source = readFileSync(filePath, "utf8");
    for (const specifier of parseImportSpecifiers(source)) {
      if (!STYLE_IMPORT_PATTERN.test(specifier)) {
        continue;
      }

      violations.push(`${toPosixPath(path.relative(ROOT_DIR, filePath))} -> ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: packages do not import visual framework dependencies", () => {
  const violations = [];

  for (const filePath of listPackageJsFiles()) {
    const source = readFileSync(filePath, "utf8");
    for (const specifier of parseImportSpecifiers(source)) {
      const forbidden = FORBIDDEN_VISUAL_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier));
      if (!forbidden) {
        continue;
      }

      violations.push(`${toPosixPath(path.relative(ROOT_DIR, filePath))} -> ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: packages do not call rendering entry APIs", () => {
  const violations = [];

  for (const filePath of listPackageJsFiles()) {
    const source = readFileSync(filePath, "utf8");
    if (/\bcreateApp\s*\(|\bdefineComponent\s*\(/.test(source)) {
      violations.push(toPosixPath(path.relative(ROOT_DIR, filePath)));
    }
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: app thin wrappers must be removed or allowlisted", () => {
  const violations = [];
  const appSourceFiles = listAppSourceJsFiles();

  for (const filePath of appSourceFiles) {
    const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
    const source = readFileSync(filePath, "utf8");
    if (!isPassThroughWrapper(source)) {
      continue;
    }

    const allowlistReason = PASS_THROUGH_WRAPPER_ALLOWLIST[relativePath];
    if (typeof allowlistReason === "string" && allowlistReason.trim().length > 0) {
      continue;
    }

    violations.push(relativePath);
  }

  assert.deepEqual(violations, []);
});

test("client architecture guardrail: app code does not import package internals", () => {
  const violations = [];
  const appFiles = listAppBoundaryJsFiles();

  for (const filePath of appFiles) {
    const source = readFileSync(filePath, "utf8");
    const relativeFilePath = toPosixPath(path.relative(ROOT_DIR, filePath));

    for (const importSpecifier of parseImportSpecifiers(source)) {
      if (/^@jskit-ai\/[^/]+\/(?:src|test|tests|lib)(?:\/|$)/.test(importSpecifier)) {
        violations.push(`${relativeFilePath} -> ${importSpecifier}`);
        continue;
      }

      const resolvedImportPath = resolveRelativeImport(filePath, importSpecifier);
      if (!resolvedImportPath) {
        continue;
      }

      const normalizedResolvedPath = path.resolve(resolvedImportPath);
      if (!normalizedResolvedPath.startsWith(PACKAGES_DIR)) {
        continue;
      }

      violations.push(`${relativeFilePath} -> ${importSpecifier}`);
    }
  }

  assert.deepEqual(violations, []);
});
