import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { compileScript, parse as parseVueSfc } from "@vue/compiler-sfc";
import tsMorph from "ts-morph";
import {
  HELPER_MAP_JSON_RELATIVE_PATH,
  HELPER_MAP_MARKDOWN_RELATIVE_PATH
} from "./helperMapPaths.js";

const {
  ModuleKind,
  ModuleResolutionKind,
  Project,
  ScriptTarget
} = tsMorph;

const HELPER_MAP_SCHEMA_VERSION = 1;
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue"]);
const APP_SCAN_ROOTS = Object.freeze(["src", "packages", "config", "server", "scripts"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".jskit",
  ".npm-cache",
  "coverage",
  "dist",
  "node_modules"
]);
const HELPER_NAME_PATTERN =
  /^(assert|build|coerce|create|ensure|extract|format|get|has|is|list|load|make|map|normalize|parse|read|render|resolve|run|serialize|to|update|use|validate|write)[A-Z_]/u;

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizePackageDependencies(packageJson = {}) {
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
    ...(packageJson.optionalDependencies || {})
  };
  return Object.keys(dependencies).sort((left, right) => left.localeCompare(right));
}

function classifySymbol(name = "") {
  if (!name || name === "default") {
    return "default";
  }
  if (/^use[A-Z]/u.test(name)) {
    return "composable";
  }
  if (/^[A-Z]/u.test(name)) {
    return "component_or_class";
  }
  if (HELPER_NAME_PATTERN.test(name)) {
    return "helper";
  }
  return "export";
}

function createExportAnalysisProject() {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
      target: ScriptTarget.ESNext
    }
  });
}

function kindFromDeclaration(declaration, exportName = "") {
  if (exportName === "default") {
    return "default";
  }
  switch (declaration.getKindName()) {
    case "ClassDeclaration":
      return "class";
    case "EnumDeclaration":
      return "enum";
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "MethodDeclaration":
      return "function";
    case "InterfaceDeclaration":
      return "interface";
    case "TypeAliasDeclaration":
      return "type";
    case "VariableDeclaration": {
      const initializer = typeof declaration.getInitializer === "function"
        ? declaration.getInitializer()
        : null;
      const initializerKind = initializer?.getKindName?.() || "";
      return initializerKind === "ArrowFunction" || initializerKind === "FunctionExpression"
        ? "function"
        : "value";
    }
    default:
      return "export";
  }
}

function addSymbol(symbols, symbol) {
  if (!symbol.name) {
    return;
  }
  const key = `${symbol.name}:${symbol.kind}`;
  if (symbols.has(key)) {
    return;
  }
  symbols.set(key, {
    name: symbol.name,
    kind: symbol.kind,
    role: classifySymbol(symbol.name)
  });
}

function extractExportedSymbols(sourceFile) {
  const symbols = new Map();
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    for (const declaration of declarations) {
      addSymbol(symbols, {
        name,
        kind: kindFromDeclaration(declaration, name)
      });
    }
  }

  return [...symbols.values()].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName || left.kind.localeCompare(right.kind);
  });
}

function extractVueScriptSource(source = "", filePath = "") {
  const parsed = parseVueSfc(source, {
    filename: filePath
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message || String(error)).join("; "));
  }
  const descriptor = parsed.descriptor;
  if (descriptor.scriptSetup) {
    return compileScript(descriptor, {
      id: filePath
    }).content;
  }
  if (descriptor.script) {
    return descriptor.script.content;
  }
  return "";
}

async function addCodeFileToProject(project, file) {
  if (path.extname(file.absolutePath) !== ".vue") {
    return project.addSourceFileAtPath(file.absolutePath);
  }
  const source = extractVueScriptSource(await readFile(file.absolutePath, "utf8"), file.absolutePath);
  if (!source.trim()) {
    return null;
  }
  return project.createSourceFile(`${file.absolutePath}.ts`, source, {
    overwrite: true
  });
}

async function walkCodeFiles(rootPath, relativeRoot = "") {
  const entries = await readdir(rootPath, {
    withFileTypes: true
  });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.join(relativeRoot, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) {
      files.push(...await walkCodeFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath
    });
  }
  return files;
}

async function collectAppExports(targetRoot) {
  const scanFiles = [];
  for (const scanRoot of APP_SCAN_ROOTS) {
    const rootPath = path.join(targetRoot, scanRoot);
    if (await pathExists(rootPath)) {
      scanFiles.push(...await walkCodeFiles(rootPath, scanRoot));
    }
  }

  const project = createExportAnalysisProject();
  const files = [];
  for (const file of scanFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const sourceFile = await addCodeFileToProject(project, file);
    if (!sourceFile) {
      continue;
    }
    const symbols = extractExportedSymbols(sourceFile);
    if (symbols.length === 0) {
      continue;
    }
    files.push({
      path: file.relativePath,
      exports: symbols
    });
  }
  return files;
}

function flattenPackageExports(exportsField) {
  const targets = new Map();

  function addTarget(subpath, target) {
    if (!target || target.includes("*")) {
      return;
    }
    targets.set(`${subpath}:${target}`, {
      subpath,
      target
    });
  }

  function collect(value, subpath = ".") {
    if (typeof value === "string") {
      addTarget(subpath, value);
      return;
    }
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return;
    }
    const entries = Object.entries(value);
    const hasSubpathKeys = entries.some(([key]) => key.startsWith("."));
    for (const [key, nested] of entries) {
      if (key.startsWith(".")) {
        collect(nested, key);
      } else {
        collect(nested, hasSubpathKeys ? subpath : subpath || ".");
      }
    }
  }

  collect(exportsField, ".");
  return [...targets.values()].sort((left, right) => {
    const bySubpath = left.subpath.localeCompare(right.subpath);
    return bySubpath || left.target.localeCompare(right.target);
  });
}

async function collectJskitPackageExports(targetRoot, packageJson = {}) {
  const packageNames = normalizePackageDependencies(packageJson)
    .filter((name) => name.startsWith("@jskit-ai/"));
  const packages = [];
  const project = createExportAnalysisProject();

  for (const packageName of packageNames) {
    const packageRoot = path.join(targetRoot, "node_modules", ...packageName.split("/"));
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!await pathExists(packageJsonPath)) {
      packages.push({
        name: packageName,
        installed: false,
        exports: []
      });
      continue;
    }

    const installedPackageJson = await readJsonFile(packageJsonPath);
    const exportTargets = flattenPackageExports(installedPackageJson.exports || {});
    const exports = [];
    for (const exportTarget of exportTargets) {
      const normalizedTarget = exportTarget.target.replace(/^\.\//u, "");
      const targetPath = path.join(packageRoot, normalizedTarget);
      const ext = path.extname(targetPath);
      if (!CODE_EXTENSIONS.has(ext) || !await pathExists(targetPath)) {
        continue;
      }
      const sourceFile = await addCodeFileToProject(project, {
        absolutePath: targetPath,
        relativePath: normalizedTarget
      });
      exports.push({
        subpath: exportTarget.subpath,
        target: normalizedTarget.split(path.sep).join("/"),
        exports: sourceFile ? extractExportedSymbols(sourceFile) : []
      });
    }

    packages.push({
      name: packageName,
      version: installedPackageJson.version || "",
      installed: true,
      exports
    });
  }

  return packages;
}

function renderExportList(symbols = []) {
  if (symbols.length === 0) {
    return "    - no exported symbols detected";
  }
  return symbols
    .map((symbol) => `    - ${symbol.name} (${symbol.kind}, ${symbol.role})`)
    .join("\n");
}

function renderHelperMapMarkdown(map) {
  const lines = [
    "# JSKIT Helper Map",
    "",
    "Generated by `jskit helper-map update`. Read this before adding new helpers, composables, service functions, maps, or package glue.",
    "",
    `Root package: ${map.rootPackage.name || "unknown"}`,
    "",
    "## App-local exports",
    ""
  ];

  if (map.app.files.length === 0) {
    lines.push("No app-local exported helpers or symbols detected.", "");
  } else {
    for (const file of map.app.files) {
      lines.push(`- ${file.path}`, renderExportList(file.exports), "");
    }
  }

  lines.push("## Direct JSKIT package exports", "");
  if (map.jskitPackages.length === 0) {
    lines.push("No direct `@jskit-ai/*` dependencies were found.", "");
  } else {
    for (const packageEntry of map.jskitPackages) {
      if (!packageEntry.installed) {
        lines.push(`- ${packageEntry.name}: not installed in node_modules`, "");
        continue;
      }
      lines.push(`- ${packageEntry.name}@${packageEntry.version || "unknown"}`);
      if (packageEntry.exports.length === 0) {
        lines.push("    - no exported code files detected");
      } else {
        for (const exportEntry of packageEntry.exports) {
          lines.push(`    - ${exportEntry.subpath} -> ${exportEntry.target}`);
          for (const symbol of exportEntry.exports) {
            lines.push(`      - ${symbol.name} (${symbol.kind}, ${symbol.role})`);
          }
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

async function buildHelperMap({ targetRoot }) {
  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  const map = {
    schemaVersion: HELPER_MAP_SCHEMA_VERSION,
    generatedBy: "jskit helper-map update",
    rootPackage: {
      name: packageJson.name || "",
      version: packageJson.version || ""
    },
    app: {
      files: await collectAppExports(targetRoot)
    },
    jskitPackages: await collectJskitPackageExports(targetRoot, packageJson)
  };
  return {
    ok: true,
    map,
    helperMapJsonPath: path.join(targetRoot, HELPER_MAP_JSON_RELATIVE_PATH),
    helperMapMarkdownPath: path.join(targetRoot, HELPER_MAP_MARKDOWN_RELATIVE_PATH)
  };
}

async function readHelperMap({ targetRoot }) {
  const helperMapJsonPath = path.join(targetRoot, HELPER_MAP_JSON_RELATIVE_PATH);
  const helperMapMarkdownPath = path.join(targetRoot, HELPER_MAP_MARKDOWN_RELATIVE_PATH);
  if (!await pathExists(helperMapJsonPath)) {
    return {
      ok: true,
      exists: false,
      helperMapJsonPath,
      helperMapMarkdownPath,
      map: null,
      markdown: ""
    };
  }
  return {
    ok: true,
    exists: true,
    helperMapJsonPath,
    helperMapMarkdownPath,
    map: await readJsonFile(helperMapJsonPath),
    markdown: await pathExists(helperMapMarkdownPath) ? await readFile(helperMapMarkdownPath, "utf8") : ""
  };
}

async function updateHelperMap({ targetRoot }) {
  const payload = await buildHelperMap({ targetRoot });
  const markdown = renderHelperMapMarkdown(payload.map);
  const json = `${JSON.stringify(payload.map, null, 2)}\n`;
  const currentJson = await pathExists(payload.helperMapJsonPath)
    ? await readFile(payload.helperMapJsonPath, "utf8")
    : "";
  const currentMarkdown = await pathExists(payload.helperMapMarkdownPath)
    ? await readFile(payload.helperMapMarkdownPath, "utf8")
    : "";
  const changed = currentJson !== json || currentMarkdown !== markdown;
  if (changed) {
    await mkdir(path.dirname(payload.helperMapJsonPath), {
      recursive: true
    });
    await writeFile(payload.helperMapJsonPath, json, "utf8");
    await writeFile(payload.helperMapMarkdownPath, markdown, "utf8");
  }
  return {
    ...payload,
    changed,
    markdown
  };
}

export {
  HELPER_MAP_JSON_RELATIVE_PATH,
  HELPER_MAP_MARKDOWN_RELATIVE_PATH,
  buildHelperMap,
  readHelperMap,
  updateHelperMap
};
