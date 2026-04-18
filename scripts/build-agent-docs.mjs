import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const AGENT_DOCS_ROOT = path.join(REPO_ROOT, "packages", "agent-docs");
const REFERENCE_AUTOGEN_ROOT = path.join(AGENT_DOCS_ROOT, "reference", "autogen");
const STARTUP_KERNEL_MAP_PATH = path.join(REFERENCE_AUTOGEN_ROOT, "KERNEL_MAP.md");
const REFERENCE_README_PATH = path.join(REFERENCE_AUTOGEN_ROOT, "README.md");
const GUIDE_SOURCE_ROOT = path.join(REPO_ROOT, "docs", "guide");
const GUIDE_HUMAN_ROOT = path.join(AGENT_DOCS_ROOT, "guide", "human");
const GUIDE_AGENT_ROOT = path.join(AGENT_DOCS_ROOT, "guide", "agent");
const LEGACY_AI_DOCS_ROOT = path.join(REPO_ROOT, "ai-docs");
const KERNEL_SHARED_ROOT = path.join(REPO_ROOT, "packages", "kernel", "shared");
const PACKAGE_ROOTS = Object.freeze([
  { groupName: "packages", rootDir: path.join(REPO_ROOT, "packages") },
  { groupName: "tooling", rootDir: path.join(REPO_ROOT, "tooling") }
]);
const SOURCE_FILE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".vue"]);
const SECTION_ORDER = Object.freeze([
  "support",
  "surface",
  "validators",
  "actions",
  "runtime",
  "shared",
  "src",
  "client",
  "server",
  "templates",
  "bin",
  "scripts",
  "root"
]);
const GUIDE_SECTION_PATTERNS_TO_DROP = [
  /^Recap\b/i,
  /^Recap From Previous Chapters\b/i
];
const SKIP_DIRECTORY_NAMES = new Set([
  ".build",
  ".git",
  ".jscpd",
  ".jskit",
  "LEGACY",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "test",
  "tests",
  "__tests__"
]);
const SKIP_FILE_PATTERNS = [
  /\.test\.[^.]+$/i,
  /\.spec\.[^.]+$/i,
  /\.vitest\.[^.]+$/i
];

function normalizeMarkdownPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeSignatureParams(rawParams = "") {
  return String(rawParams || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushUnique(items, item) {
  if (!items.includes(item)) {
    items.push(item);
  }
}

function createDeclarationPattern(sourcePattern) {
  return new RegExp(`^${sourcePattern}`, "gm");
}

function shouldSkipFile(fileName) {
  return SKIP_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

async function collectWorkspaceDirectories() {
  const results = [];

  for (const { groupName, rootDir } of PACKAGE_ROOTS) {
    const entries = await readdir(rootDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      results.push({
        groupName,
        workspaceName: entry.name,
        workspaceDir: path.join(rootDir, entry.name)
      });
    }
  }

  return results;
}

async function collectSourceFilePaths(rootDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORY_NAMES.has(entry.name)) {
          await walk(entryPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkipFile(entry.name)) {
        continue;
      }
      if (!SOURCE_FILE_EXTENSIONS.includes(path.extname(entry.name))) {
        continue;
      }
      results.push(entryPath);
    }
  }

  await walk(rootDir);
  return results;
}

async function collectMarkdownFilePaths(rootDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && path.extname(entry.name) === ".md") {
        results.push(entryPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

function extractVueScriptText(sourceText = "") {
  const scriptBlocks = [];
  const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of sourceText.matchAll(scriptBlockPattern)) {
    const scriptContent = String(match[1] || "").trim();
    if (scriptContent) {
      scriptBlocks.push(scriptContent);
    }
  }

  return scriptBlocks.join("\n\n");
}

function normalizeSourceText(filePath, sourceText) {
  if (path.extname(filePath) === ".vue") {
    return extractVueScriptText(sourceText);
  }
  return sourceText;
}

function collectTopLevelDeclarations(sourceText) {
  const declarations = [];
  const addDeclaration = (kind, name, params, index) => {
    if (!name) {
      return;
    }
    declarations.push({
      index,
      kind,
      name,
      signature: kind === "class"
        ? `${name}`
        : `${name}(${normalizeSignatureParams(params)})`
    });
  };

  const patterns = [
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*\{`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([\s\S]*?)\)\s*=>`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([\s\S]*?)\)\s*\{`)
    },
    {
      kind: "class",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b`)
    }
  ];

  for (const { kind, pattern } of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const [, name = "", params = ""] = match;
      addDeclaration(kind, name, params, match.index ?? 0);
    }
  }

  declarations.sort((left, right) => left.index - right.index);

  const declarationByName = new Map();
  for (const declaration of declarations) {
    if (!declarationByName.has(declaration.name)) {
      declarationByName.set(declaration.name, declaration);
    }
  }

  return declarationByName;
}

function parseExportSpecifierBlock(specifierBlock = "") {
  const results = [];
  const fragments = String(specifierBlock || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    const parts = fragment.split(/\s+as\s+/i).map((entry) => entry.trim()).filter(Boolean);
    const exportedName = parts[1] || parts[0] || "";
    if (exportedName) {
      pushUnique(results, exportedName);
    }
  }

  return results;
}

function collectExportedSymbols(sourceText, declarationByName) {
  const exportedSymbols = [];

  const pushExport = (exportedName) => {
    if (!exportedName) {
      return;
    }
    const declaration = declarationByName.get(exportedName);
    pushUnique(exportedSymbols, declaration?.signature || exportedName);
  };

  const directPatterns = [
    createDeclarationPattern(String.raw`export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*\{`),
    createDeclarationPattern(String.raw`export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b`),
    createDeclarationPattern(String.raw`export\s+class\s+([A-Za-z_$][\w$]*)\b`)
  ];

  for (const pattern of directPatterns) {
    for (const match of sourceText.matchAll(pattern)) {
      pushExport(match[1] || "");
    }
  }

  const exportBlockPattern = /^export\s*\{([\s\S]*?)\}\s*(?:from\s+["'][^"']+["'])?\s*;?/gm;
  for (const match of sourceText.matchAll(exportBlockPattern)) {
    for (const exportedName of parseExportSpecifierBlock(match[1])) {
      pushExport(exportedName);
    }
  }

  const exportDefaultFunctionPattern = /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?\s*\(([\s\S]*?)\)\s*\{/gm;
  for (const match of sourceText.matchAll(exportDefaultFunctionPattern)) {
    const exportedName = match[1] || "default";
    pushUnique(exportedSymbols, `${exportedName}(${normalizeSignatureParams(match[2])})`);
  }

  const exportDefaultClassPattern = /^export\s+default\s+class\s+([A-Za-z_$][\w$]*)?\b/gm;
  for (const match of sourceText.matchAll(exportDefaultClassPattern)) {
    pushUnique(exportedSymbols, match[1] || "default");
  }

  if (/^export\s+default\s+\{/m.test(sourceText) || /^export\s+default\s+defineComponent\s*\(/m.test(sourceText)) {
    pushUnique(exportedSymbols, "default");
  }

  return exportedSymbols;
}

function collectLocalFunctions(declarationByName, exportedSymbols) {
  const exportedNames = new Set(
    exportedSymbols.map((entry) => String(entry || "").split("(")[0])
  );
  const localFunctions = [];

  for (const declaration of declarationByName.values()) {
    if (declaration.kind !== "function") {
      continue;
    }
    if (exportedNames.has(declaration.name)) {
      continue;
    }
    pushUnique(localFunctions, declaration.signature);
  }

  return localFunctions;
}

function resolveSectionName(relativePath) {
  const normalizedPath = normalizeMarkdownPath(relativePath);
  const segments = normalizedPath.split("/");
  return segments.length > 1 ? segments[0] : "root";
}

function sortSectionNames(sectionNames = []) {
  const orderIndex = new Map(SECTION_ORDER.map((sectionName, index) => [sectionName, index]));
  return [...sectionNames].sort((left, right) => {
    const leftRank = orderIndex.has(left) ? orderIndex.get(left) : Number.MAX_SAFE_INTEGER;
    const rightRank = orderIndex.has(right) ? orderIndex.get(right) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

function renderSection(fileEntries = []) {
  const lines = [];

  for (const entry of fileEntries) {
    lines.push(`### \`${entry.relativePath}\``);
    lines.push("Exports");
    if (entry.exportedSymbols.length > 0) {
      for (const exportedSymbol of entry.exportedSymbols) {
        lines.push(`- \`${exportedSymbol}\``);
      }
    } else {
      lines.push("- None");
    }

    if (entry.localFunctions.length > 0) {
      lines.push("Local functions");
      for (const localFunction of entry.localFunctions) {
        lines.push(`- \`${localFunction}\``);
      }
    }

    lines.push("");
  }

  return lines;
}

function renderMap({ title, commandName, introLines = [], scopeLines = [], sectionHeading = "## Sections", fileEntries = [] }) {
  const fileEntriesBySection = new Map();
  for (const entry of fileEntries) {
    if (!fileEntriesBySection.has(entry.sectionName)) {
      fileEntriesBySection.set(entry.sectionName, []);
    }
    fileEntriesBySection.get(entry.sectionName).push(entry);
  }

  const lines = [
    `# ${title}`,
    "",
    `Generated by \`${commandName}\`.`,
    "Do not edit manually.",
    ""
  ];

  if (introLines.length > 0) {
    lines.push(...introLines, "");
  }

  if (scopeLines.length > 0) {
    lines.push("## Scope", ...scopeLines, "");
  }

  lines.push(sectionHeading, "");

  for (const sectionName of sortSectionNames([...fileEntriesBySection.keys()])) {
    lines.push(`### ${sectionName}`);
    lines.push("");
    lines.push(...renderSection(fileEntriesBySection.get(sectionName) || []));
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function buildFileEntries(sourceRoot) {
  const sourceFilePaths = await collectSourceFilePaths(sourceRoot);
  const fileEntries = [];

  for (const sourceFilePath of sourceFilePaths) {
    const relativePath = normalizeMarkdownPath(path.relative(sourceRoot, sourceFilePath));
    const rawSourceText = await readFile(sourceFilePath, "utf8");
    const sourceText = normalizeSourceText(sourceFilePath, rawSourceText);
    const declarationByName = collectTopLevelDeclarations(sourceText);
    const exportedSymbols = collectExportedSymbols(sourceText, declarationByName);
    const localFunctions = collectLocalFunctions(declarationByName, exportedSymbols);

    fileEntries.push({
      relativePath,
      sectionName: resolveSectionName(relativePath),
      exportedSymbols,
      localFunctions
    });
  }

  fileEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return fileEntries;
}

async function writeTextFile(targetPath, text) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, text, "utf8");
}

function toGeneratedGuideText(sourceText, { commandName, sourcePath }) {
  const normalized = String(sourceText || "").trim();
  return `<!-- Generated by \`${commandName}\` from \`${sourcePath}\`. Do not edit manually. -->\n\n${normalized}\n`;
}

function extractQuotedAttribute(source = "", attributeName = "") {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`);
  const match = String(source || "").match(pattern);
  return String(match?.[1] || "").trim();
}

function renderDocsTerminalTip(attributes = "", content = "") {
  const label = extractQuotedAttribute(attributes, "label");
  const title = extractQuotedAttribute(attributes, "title");
  const heading = [label, title].filter(Boolean).join(": ") || "Note";
  const normalizedContent = String(content || "").trim();
  return `**${heading}**\n\n${normalizedContent}`;
}

function stripMarkdownSections(sourceText = "", titlePatterns = []) {
  const lines = String(sourceText || "").split("\n");
  const results = [];
  let inCodeFence = false;
  let skipHeadingLevel = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      if (skipHeadingLevel === null) {
        results.push(line);
      }
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const headingLevel = headingMatch[1].length;
        const headingTitle = String(headingMatch[2] || "").trim();

        if (skipHeadingLevel !== null && headingLevel <= skipHeadingLevel) {
          skipHeadingLevel = null;
        }

        if (skipHeadingLevel === null && titlePatterns.some((pattern) => pattern.test(headingTitle))) {
          skipHeadingLevel = headingLevel;
          continue;
        }
      }
    }

    if (skipHeadingLevel !== null) {
      continue;
    }

    results.push(line);
  }

  return results.join("\n");
}

function stripDecorativeHtmlLines(sourceText = "") {
  const lines = String(sourceText || "").split("\n");
  const results = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      results.push(line);
      continue;
    }

    if (!inCodeFence) {
      const isDecorativeHtml =
        trimmed.startsWith("<figure") ||
        trimmed.startsWith("</figure") ||
        trimmed.startsWith("<div ") ||
        trimmed === "</div>" ||
        trimmed.startsWith("<img ") ||
        trimmed.startsWith("<span") ||
        trimmed === "</span>";

      if (isDecorativeHtml) {
        continue;
      }
    }

    results.push(line);
  }

  return results.join("\n");
}

function compressGuideMarkdown(sourceText = "") {
  let output = String(sourceText || "").replace(/\r\n/g, "\n");
  output = output.replace(/<figure[\s\S]*?<\/figure>/g, "");
  output = output.replace(
    /<DocsTerminalTip([^>]*)>([\s\S]*?)<\/DocsTerminalTip>/g,
    (_, attributes = "", content = "") => renderDocsTerminalTip(attributes, content)
  );
  output = stripMarkdownSections(output, GUIDE_SECTION_PATTERNS_TO_DROP);
  output = stripDecorativeHtmlLines(output);
  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return `${output}\n`;
}

async function clearAgentDocsOutputs() {
  await rm(REFERENCE_AUTOGEN_ROOT, { recursive: true, force: true });
  await rm(GUIDE_HUMAN_ROOT, { recursive: true, force: true });
  await rm(GUIDE_AGENT_ROOT, { recursive: true, force: true });
  await rm(LEGACY_AI_DOCS_ROOT, { recursive: true, force: true });
}

async function buildStartupKernelMap(commandName) {
  const fileEntries = await buildFileEntries(KERNEL_SHARED_ROOT);
  const outputText = renderMap({
    title: "Kernel Shared Map",
    commandName,
    introLines: [
      "Use this as startup navigation for canonical shared helpers before adding new helpers locally.",
      "For the full repo inventory, read `reference/autogen/README.md` and the package maps it lists.",
      "",
      "## Reuse Order",
      "1. `packages/kernel/shared/support/*`",
      "2. `packages/kernel/shared/surface/*`",
      "3. `packages/kernel/shared/validators/*`",
      "4. `packages/kernel/shared/actions/*`",
      "5. `packages/kernel/shared/runtime/*`"
    ],
    scopeLines: [
      `- Source: \`${normalizeMarkdownPath(path.relative(REPO_ROOT, KERNEL_SHARED_ROOT))}/**/*{.js,.mjs,.cjs,.vue}\``,
      "- Excludes: `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*.vitest.*`"
    ],
    fileEntries
  });

  await writeTextFile(STARTUP_KERNEL_MAP_PATH, outputText);
}

function renderReferenceReadme(workspaceMaps, commandName) {
  const packageMaps = workspaceMaps.filter((entry) => entry.groupName === "packages");
  const toolingMaps = workspaceMaps.filter((entry) => entry.groupName === "tooling");
  const lines = [
    "# Agent Reference Index",
    "",
    `Generated by \`${commandName}\`.`,
    "Do not edit manually.",
    "",
    "This directory contains generated, on-demand package maps.",
    "Startup navigation stays in `KERNEL_MAP.md`.",
    "",
    "## Package Maps"
  ];

  for (const entry of packageMaps) {
    lines.push(`- [${entry.workspaceName}](/${normalizeMarkdownPath(path.relative(REPO_ROOT, entry.outputPath))})`);
  }

  lines.push("", "## Tooling Maps");
  for (const entry of toolingMaps) {
    lines.push(`- [${entry.workspaceName}](/${normalizeMarkdownPath(path.relative(REPO_ROOT, entry.outputPath))})`);
  }

  return `${lines.join("\n").trim()}\n`;
}

async function buildReferenceMaps(commandName) {
  const workspaceDirectories = await collectWorkspaceDirectories();
  const workspaceMaps = [];

  for (const workspace of workspaceDirectories) {
    const fileEntries = await buildFileEntries(workspace.workspaceDir);
    const outputPath = path.join(
      REFERENCE_AUTOGEN_ROOT,
      workspace.groupName,
      `${workspace.workspaceName}.md`
    );
    const outputText = renderMap({
      title: `${workspace.groupName}/${workspace.workspaceName}`,
      commandName,
      introLines: [
        `Generated inventory for \`${normalizeMarkdownPath(path.relative(REPO_ROOT, workspace.workspaceDir))}\`.`,
        "Use this on demand; do not load the full index at startup."
      ],
      scopeLines: [
        `- Source: \`${normalizeMarkdownPath(path.relative(REPO_ROOT, workspace.workspaceDir))}/**/*{.js,.mjs,.cjs,.vue}\``,
        "- Excludes: `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*.vitest.*`, `node_modules/`, `dist/`, `coverage/`, `docs/`, `LEGACY/`"
      ],
      fileEntries
    });

    await writeTextFile(outputPath, outputText);
    workspaceMaps.push({
      ...workspace,
      outputPath
    });
  }

  workspaceMaps.sort((left, right) => {
    if (left.groupName !== right.groupName) {
      return left.groupName.localeCompare(right.groupName);
    }
    return left.workspaceName.localeCompare(right.workspaceName);
  });

  await writeTextFile(
    REFERENCE_README_PATH,
    renderReferenceReadme(workspaceMaps, commandName)
  );
}

async function buildGuideOutputs(commandName) {
  const markdownFilePaths = await collectMarkdownFilePaths(GUIDE_SOURCE_ROOT);

  for (const sourceFilePath of markdownFilePaths) {
    const relativePath = normalizeMarkdownPath(path.relative(GUIDE_SOURCE_ROOT, sourceFilePath));
    const sourceMarkdownPath = normalizeMarkdownPath(path.relative(REPO_ROOT, sourceFilePath));
    const sourceText = await readFile(sourceFilePath, "utf8");

    await writeTextFile(
      path.join(GUIDE_HUMAN_ROOT, relativePath),
      toGeneratedGuideText(sourceText, {
        commandName,
        sourcePath: sourceMarkdownPath
      })
    );

    await writeTextFile(
      path.join(GUIDE_AGENT_ROOT, relativePath),
      toGeneratedGuideText(compressGuideMarkdown(sourceText), {
        commandName,
        sourcePath: sourceMarkdownPath
      })
    );
  }
}

async function main() {
  const commandName = "npm run agent-docs:build";
  await clearAgentDocsOutputs();
  await mkdir(AGENT_DOCS_ROOT, { recursive: true });
  await mkdir(REFERENCE_AUTOGEN_ROOT, { recursive: true });
  await mkdir(GUIDE_HUMAN_ROOT, { recursive: true });
  await mkdir(GUIDE_AGENT_ROOT, { recursive: true });
  await buildStartupKernelMap(commandName);
  await buildReferenceMaps(commandName);
  await buildGuideOutputs(commandName);
  process.stdout.write(`Wrote ${normalizeMarkdownPath(path.relative(REPO_ROOT, STARTUP_KERNEL_MAP_PATH))}\n`);
  process.stdout.write(`Wrote ${normalizeMarkdownPath(path.relative(REPO_ROOT, REFERENCE_README_PATH))}\n`);
  process.stdout.write(`Wrote ${normalizeMarkdownPath(path.relative(REPO_ROOT, GUIDE_HUMAN_ROOT))}\n`);
  process.stdout.write(`Wrote ${normalizeMarkdownPath(path.relative(REPO_ROOT, GUIDE_AGENT_ROOT))}\n`);
}

await main();
