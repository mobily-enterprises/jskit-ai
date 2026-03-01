import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listFilesRecursive } from "../helpers/listFilesRecursive.mjs";
import { parseImportSpecifiers } from "../helpers/parseImportSpecifiers.mjs";
import { toPosixPath } from "../helpers/pathUtils.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const APPS_DIR = path.join(ROOT_DIR, "apps");
const TESTS_DIR = path.join(ROOT_DIR, "tests");
const DOCS_DIR = path.join(ROOT_DIR, "docs");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const GUARDRAIL_SCAN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".vue", ".md", ".json"]);
const WEB_RUNTIME_CORE_DIR = path.join(PACKAGES_DIR, "web", "web-runtime-core");
const WEB_RUNTIME_CORE_PACKAGE_JSON = path.join(WEB_RUNTIME_CORE_DIR, "package.json");
const WEB_RUNTIME_CORE_API_CLIENTS_DIR = path.join(WEB_RUNTIME_CORE_DIR, "src", "shared", "apiClients");
const WORKSPACE_CONSOLE_SERVICE_DIR = path.join(PACKAGES_DIR, "workspace", "workspace-console-service-core");
const WORKSPACE_CONSOLE_PACKAGE_JSON = path.join(WORKSPACE_CONSOLE_SERVICE_DIR, "package.json");
const WORKSPACE_CONSOLE_INDEX_FILE = path.join(WORKSPACE_CONSOLE_SERVICE_DIR, "src", "shared", "index.js");
const WORKSPACE_CONSOLE_CORE_CONTRIBUTOR_FILE = path.join(
  WORKSPACE_CONSOLE_SERVICE_DIR,
  "src",
  "shared",
  "actions",
  "consoleCore.contributor.js"
);
const APP_RUNTIME_SERVICES_FILE = path.join(APPS_DIR, "jskit-value-app", "server", "runtime", "services.js");
const FORBIDDEN_WEB_RUNTIME_IMPORT = "@jskit-ai/web-runtime-core/apiClients";
const MIGRATION_DOC_PATTERN = /(^|\/)THE_GREAT_TIDYING_UP(?:_BASELINE)?\.md$/i;
const WEB_RUNTIME_CORE_IMPORT_GUARDRAIL_ALLOWLIST = new Set([
  "tests/architecture/client-architecture.guardrails.test.mjs",
  "packages/web/web-runtime-core/src/shared/runtimeOnlyGuardrails.test.js"
]);
const CLIENT_ELEMENT_PACKAGE_SEGMENTS = Object.freeze([
  "packages/ai-agent/assistant-client-element/",
  "packages/ai-agent/assistant-transcript-explorer-client-element/",
  "packages/chat/chat-client-element/",
  "packages/billing/billing-commerce-client-element/",
  "packages/billing/billing-console-admin-client-element/",
  "packages/billing/billing-plan-client-element/",
  "packages/observability/console-errors-client-element/",
  "packages/users/members-admin-client-element/",
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
const TEMPLATE_PATH_ALLOWLIST_PREFIXES = Object.freeze([
  "packages/tooling/create-app/templates/",
  "packages/tooling/jskit/packages/web-shell-host/templates/"
]);
const RENDERING_ENTRY_API_ALLOWLIST_PREFIXES = Object.freeze([
  "packages/tooling/create-app/src/",
  "packages/tooling/create-app/templates/",
  "packages/tooling/jskit/packages/web-shell-host/templates/"
]);

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

function listGuardrailScanFiles() {
  const files = [];

  for (const rootEntry of readdirSync(ROOT_DIR, { withFileTypes: true })) {
    if (!rootEntry.isFile()) {
      continue;
    }

    const absolutePath = path.join(ROOT_DIR, rootEntry.name);
    if (!GUARDRAIL_SCAN_EXTENSIONS.has(path.extname(absolutePath))) {
      continue;
    }

    files.push(absolutePath);
  }

  for (const scopedDir of [APPS_DIR, PACKAGES_DIR, TESTS_DIR, DOCS_DIR]) {
    files.push(
      ...listFilesRecursive(scopedDir, (absolutePath) => {
        return GUARDRAIL_SCAN_EXTENSIONS.has(path.extname(absolutePath));
      })
    );
  }

  return files.sort((left, right) => left.localeCompare(right));
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
    const isTemplateFile = TEMPLATE_PATH_ALLOWLIST_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
    if (isTemplateFile) {
      continue;
    }

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
    const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
    const isAllowlisted = RENDERING_ENTRY_API_ALLOWLIST_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
    if (isAllowlisted) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    if (/\bcreateApp\s*\(|\bdefineComponent\s*\(/.test(source)) {
      violations.push(relativePath);
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

test("client architecture guardrail: web-runtime-core has no apiClients exports or imports", () => {
  const packageJson = JSON.parse(readFileSync(WEB_RUNTIME_CORE_PACKAGE_JSON, "utf8"));
  const exportKeys = Object.keys(packageJson?.exports || {});
  const forbiddenExportKeys = exportKeys.filter((entry) => entry === "./apiClients" || entry.startsWith("./apiClients/"));

  assert.deepEqual(forbiddenExportKeys, []);
  assert.equal(existsSync(WEB_RUNTIME_CORE_API_CLIENTS_DIR), false);

  const offenders = [];
  for (const filePath of listGuardrailScanFiles()) {
    const relativePath = toPosixPath(path.relative(ROOT_DIR, filePath));
    if (
      MIGRATION_DOC_PATTERN.test(relativePath) ||
      WEB_RUNTIME_CORE_IMPORT_GUARDRAIL_ALLOWLIST.has(relativePath)
    ) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    if (source.includes(FORBIDDEN_WEB_RUNTIME_IMPORT)) {
      offenders.push(relativePath);
    }
  }

  assert.deepEqual(offenders, []);
});

test("client architecture guardrail: workspace-console-service-core does not export moved billing/error services", () => {
  const packageJson = JSON.parse(readFileSync(WORKSPACE_CONSOLE_PACKAGE_JSON, "utf8"));
  const exportKeys = Object.keys(packageJson?.exports || {});
  const forbiddenServiceExports = [
    "./services/errors",
    "./services/consoleBilling",
    "./services/billingSettings",
    "./services/billingCatalog",
    "./services/billingCatalogProviderPricing"
  ];
  const exportViolations = forbiddenServiceExports.filter((entry) => exportKeys.includes(entry));

  assert.deepEqual(exportViolations, []);
  assert.equal(Object.hasOwn(packageJson?.dependencies || {}, "@jskit-ai/billing-service-core"), false);

  const indexSource = readFileSync(WORKSPACE_CONSOLE_INDEX_FILE, "utf8");
  const indexViolations = forbiddenServiceExports.filter((entry) => {
    const serviceName = entry.replace("./services/", "");
    return indexSource.includes(`${serviceName}.service.js`);
  });

  assert.deepEqual(indexViolations, []);
});

test("client architecture guardrail: workspace console core contributor excludes billing and transcript action ids", () => {
  const source = readFileSync(WORKSPACE_CONSOLE_CORE_CONTRIBUTOR_FILE, "utf8");

  assert.equal(/console\\.billing\\./.test(source), false);
  assert.equal(/console\\.ai\\.transcripts?\\./.test(source), false);
});

test("client architecture guardrail: app runtime services file does not define extracted ownership helpers", () => {
  const source = readFileSync(APP_RUNTIME_SERVICES_FILE, "utf8");
  const forbiddenDefinitions = [
    "createBillingDisabledServices",
    "createBillingSubsystem",
    "createSocialOutboxWorkerRuntimeService",
    "throwEnabledSubsystemStartupPreflightError"
  ];

  const violations = forbiddenDefinitions.filter((name) => {
    const pattern = new RegExp(`function\\s+${name}\\s*\\(`);
    return pattern.test(source);
  });

  assert.deepEqual(violations, []);
});
