#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSyncDocSnippets } from "./sync-doc-snippets.mjs";

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function fileExists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(absPath) {
  const text = await fs.readFile(absPath, "utf8");
  return JSON.parse(text);
}

function ensureString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureStringArray(value) {
  return Array.isArray(value) && value.every((item) => ensureString(item));
}

function resolveAbs(repoRoot, relativePath) {
  return path.resolve(repoRoot, relativePath);
}

function expandStructuralPathVariants(relativePath) {
  if (!ensureString(relativePath)) return [];
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("src/")) {
    return [normalized, normalized.replace(/^src\//, "stages/")];
  }
  if (normalized.startsWith("stages/")) {
    return [normalized, normalized.replace(/^stages\//, "src/")];
  }
  return [normalized];
}

async function findExistingPath(baseDirAbs, relativePath) {
  const variants = expandStructuralPathVariants(relativePath);
  for (const variant of variants) {
    const abs = path.join(baseDirAbs, variant);
    if (await fileExists(abs)) {
      return {
        found: true,
        abs,
        variant
      };
    }
  }

  return {
    found: false,
    abs: path.join(baseDirAbs, relativePath),
    variant: relativePath
  };
}

async function verifyManifestStructure({ manifest, errors }) {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    errors.push("manifest must be an object");
    return;
  }

  if (typeof manifest.version !== "number") {
    errors.push("manifest.version must be a number");
  }

  const requiredFiles = manifest.requiredExampleShape?.files;
  if (!ensureStringArray(requiredFiles) || requiredFiles.length === 0) {
    errors.push("manifest.requiredExampleShape.files must be a non-empty string array");
  }

  if (!Array.isArray(manifest.chapters) || manifest.chapters.length === 0) {
    errors.push("manifest.chapters must be a non-empty array");
  }
}

async function verifyExamplePackage({ chapterNumber, manualText, example, requiredFiles, repoRoot, errors, stats }) {
  if (!ensureString(example.packageDir)) {
    errors.push(`chapter ${chapterNumber}: example.packageDir must be a non-empty string`);
    return;
  }

  const packageDirAbs = resolveAbs(repoRoot, example.packageDir);
  if (!(await fileExists(packageDirAbs))) {
    errors.push(`chapter ${chapterNumber}: missing packageDir ${example.packageDir}`);
    return;
  }

  if (!manualText.includes(example.packageDir)) {
    errors.push(
      `chapter ${chapterNumber}: manual does not reference example package ${example.packageDir}`
    );
  }

  if (!ensureString(example.entrypoint)) {
    errors.push(`chapter ${chapterNumber}: ${example.packageDir} is missing entrypoint`);
  } else {
    const entry = await findExistingPath(packageDirAbs, example.entrypoint);
    if (!entry.found) {
      errors.push(`chapter ${chapterNumber}: missing entrypoint ${example.packageDir}/${example.entrypoint}`);
    }
  }

  for (const file of requiredFiles) {
    const required = await findExistingPath(packageDirAbs, file);
    if (!required.found) {
      errors.push(`chapter ${chapterNumber}: ${example.packageDir} missing required file ${file}`);
    }
  }

  const packageJsonAbs = path.join(packageDirAbs, "package.json");
  if (await fileExists(packageJsonAbs)) {
    try {
      const packageJson = await readJson(packageJsonAbs);
      if (!ensureString(packageJson.name)) {
        errors.push(`chapter ${chapterNumber}: ${example.packageDir}/package.json missing valid name`);
      }

      const exportsField = packageJson.exports;
      const exportKeys = ["./client", "./server", "./shared"];
      for (const key of exportKeys) {
        if (!exportsField || typeof exportsField[key] !== "string") {
          errors.push(
            `chapter ${chapterNumber}: ${example.packageDir}/package.json missing exports["${key}"]`
          );
        }
      }
    } catch (error) {
      errors.push(`chapter ${chapterNumber}: invalid package.json in ${example.packageDir}: ${error.message}`);
    }
  }

  stats.examples += 1;
}

async function verifySourceList({ chapterNumber, manualText, items, label, repoRoot, errors }) {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!ensureString(item?.source)) {
      errors.push(`chapter ${chapterNumber}: ${label} item is missing source path`);
      continue;
    }

    const sourceAbs = resolveAbs(repoRoot, item.source);
    if (!(await fileExists(sourceAbs))) {
      errors.push(`chapter ${chapterNumber}: missing ${label} source ${item.source}`);
      continue;
    }

    if (!manualText.includes(item.source)) {
      errors.push(
        `chapter ${chapterNumber}: manual does not reference ${label} source ${item.source}`
      );
    }
  }
}

async function verifyProgressive({ chapterNumber, manualText, progressive, repoRoot, errors }) {
  if (!progressive) return;

  for (const key of ["start", "end"]) {
    const source = progressive[key];
    if (!ensureString(source)) {
      errors.push(`chapter ${chapterNumber}: progressive.${key} must be a non-empty string`);
      continue;
    }

    const sourceAbs = resolveAbs(repoRoot, source);
    if (!(await fileExists(sourceAbs))) {
      errors.push(`chapter ${chapterNumber}: missing progressive.${key} source ${source}`);
      continue;
    }

    if (!manualText.includes(source)) {
      errors.push(`chapter ${chapterNumber}: manual does not reference progressive.${key} source ${source}`);
    }
  }
}

export async function runVerifyDocExamples({ repoRoot = resolveRepoRoot(), quiet = false } = {}) {
  const errors = [];
  const stats = {
    chapters: 0,
    examples: 0
  };

  const manifestPath = path.resolve(repoRoot, "docs/examples/manifest.json");
  if (!(await fileExists(manifestPath))) {
    errors.push("Missing docs/examples/manifest.json");
    return {
      success: false,
      errors,
      stats
    };
  }

  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    errors.push(`Failed to parse docs/examples/manifest.json: ${error.message}`);
    return {
      success: false,
      errors,
      stats
    };
  }

  await verifyManifestStructure({ manifest, errors });

  const requiredFiles = manifest.requiredExampleShape?.files || [];

  for (const chapter of manifest.chapters || []) {
    const chapterNumber = chapter.chapter;

    if (typeof chapterNumber !== "number") {
      errors.push("chapter.chapter must be a number");
      continue;
    }

    if (!ensureString(chapter.manual)) {
      errors.push(`chapter ${chapterNumber}: manual path missing`);
      continue;
    }

    const manualAbs = resolveAbs(repoRoot, chapter.manual);
    if (!(await fileExists(manualAbs))) {
      errors.push(`chapter ${chapterNumber}: missing manual file ${chapter.manual}`);
      continue;
    }

    const manualText = await fs.readFile(manualAbs, "utf8");

    if (!Array.isArray(chapter.examples) || chapter.examples.length === 0) {
      errors.push(`chapter ${chapterNumber}: examples must be a non-empty array`);
      continue;
    }

    stats.chapters += 1;

    for (const example of chapter.examples) {
      await verifyExamplePackage({
        chapterNumber,
        manualText,
        example,
        requiredFiles,
        repoRoot,
        errors,
        stats
      });
    }

    await verifySourceList({
      chapterNumber,
      manualText,
      items: chapter.sections,
      label: "section",
      repoRoot,
      errors
    });

    await verifySourceList({
      chapterNumber,
      manualText,
      items: chapter.stages,
      label: "stage",
      repoRoot,
      errors
    });

    await verifyProgressive({
      chapterNumber,
      manualText,
      progressive: chapter.progressive,
      repoRoot,
      errors
    });
  }

  const syncCheck = await runSyncDocSnippets({ check: true, repoRoot, quiet: true });
  if (!syncCheck.success) {
    if (syncCheck.errors.length > 0) {
      errors.push(...syncCheck.errors.map((error) => `docs:sync ${error}`));
    }
    if (syncCheck.changedFiles.length > 0) {
      errors.push(
        `docs:sync out-of-sync markdown files: ${syncCheck.changedFiles.join(", ")}`
      );
    }
  }

  if (!quiet) {
    if (errors.length > 0) {
      console.error("[docs:verify] FAILED");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
    } else {
      console.log(
        `[docs:verify] OK (${stats.chapters} chapter(s), ${stats.examples} example package(s), ${syncCheck.totalBlocks} sync block(s)).`
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
    stats
  };
}

async function main() {
  const result = await runVerifyDocExamples();
  if (!result.success) {
    process.exitCode = 1;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[docs:verify] ${error.message}`);
    process.exitCode = 1;
  });
}
