import path from "node:path";
import fs from "node:fs/promises";

const PROCESS_ENV_PATTERN = /\bprocess\.env\b/;

function toPosixRelativePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function toSet(values = []) {
  return new Set(Array.from(values || []).map((entry) => String(entry || "").trim()).filter(Boolean));
}

function isAllowedFile(relativePath, allowedFilesSet) {
  return allowedFilesSet.has(toPosixRelativePath(relativePath));
}

async function listSourceFiles({ rootDir, excludedDirNames, extensions, relativePrefix = "" } = {}) {
  const startDir = path.resolve(rootDir, relativePrefix);
  const entries = await fs.readdir(startDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludedDirNames.has(entry.name)) {
        continue;
      }
      const nextPrefix = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      files.push(
        ...(await listSourceFiles({
          rootDir,
          excludedDirNames,
          extensions,
          relativePrefix: nextPrefix
        }))
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!extensions.has(extension)) {
      continue;
    }

    files.push(relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name);
  }

  return files;
}

async function findProcessEnvViolations({ rootDir, files, allowedFilesSet } = {}) {
  const violations = [];

  for (const relativePath of files) {
    if (isAllowedFile(relativePath, allowedFilesSet)) {
      continue;
    }

    const absolutePath = path.resolve(rootDir, relativePath);
    const sourceText = await fs.readFile(absolutePath, "utf8");
    if (!PROCESS_ENV_PATTERN.test(sourceText)) {
      continue;
    }

    const lines = sourceText.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!PROCESS_ENV_PATTERN.test(lines[index])) {
        continue;
      }
      violations.push({
        file: toPosixRelativePath(relativePath),
        line: index + 1,
        text: lines[index].trim()
      });
    }
  }

  return violations;
}

function createViolationReport({ allowedFiles = [], violations = [] } = {}) {
  const lines = [
    "Disallowed process.env usage detected outside approved files.",
    "Allowed files:",
    ...Array.from(allowedFiles).sort().map((file) => `- ${toPosixRelativePath(file)}`),
    "",
    "Violations:",
    ...violations.map((violation) => `- ${violation.file}:${violation.line}: ${violation.text}`)
  ];

  return lines.join("\n");
}

async function runProcessEnvGuardrail({
  rootDir,
  extensions = [".js", ".cjs", ".mjs"],
  excludedDirNames = [
    ".git",
    "node_modules",
    "tests",
    "dist",
    "dist-internal",
    "dist-public",
    "coverage",
    ".vite"
  ],
  allowFiles = ["server/lib/runtimeEnv.js", "knexfile.cjs", "vite.config.mjs", "playwright.config.mjs"]
} = {}) {
  const resolvedRootDir = path.resolve(String(rootDir || process.cwd()));
  const extensionsSet = toSet(extensions.map((entry) => String(entry || "").toLowerCase()));
  const excludedDirSet = toSet(excludedDirNames);
  const allowedFilesSet = toSet(allowFiles.map((entry) => toPosixRelativePath(entry)));

  const files = await listSourceFiles({
    rootDir: resolvedRootDir,
    excludedDirNames: excludedDirSet,
    extensions: extensionsSet
  });
  const violations = await findProcessEnvViolations({
    rootDir: resolvedRootDir,
    files,
    allowedFilesSet
  });

  return {
    rootDir: resolvedRootDir,
    allowedFiles: Array.from(allowedFilesSet),
    violations,
    ok: violations.length < 1
  };
}

export { runProcessEnvGuardrail, createViolationReport, toPosixRelativePath };
