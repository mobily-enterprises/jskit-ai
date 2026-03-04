#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SYNC_BLOCK_RE =
  /<!--\s*DOCS:SYNC\s+source="([^"]+)"\s+snippet="([^"]+)"(?:\s+lang="([^"]+)")?\s*-->\s*\n```([^\n]*)\n([\s\S]*?)\n```\s*\n<!--\s*\/DOCS:SYNC\s*-->/g;
const EXAMPLE_BLOCK_RE =
  /<!--\s*DOCS:EXAMPLE\s+([^>]+?)\s*-->\s*\n```([^\n]*)\n([\s\S]*?)\n```\s*\n<!--\s*\/DOCS:EXAMPLE\s*-->/g;
const EXAMPLE_ARTIFACT_PATHS = Object.freeze({
  controller: "src/server/controllers",
  provider: "src/server/providers",
  service: "src/server/services",
  action: "src/server/actions",
  repository: "src/server/repositories",
  schema: "src/shared/schemas"
});

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function listMarkdownFiles(dirEntries) {
  return dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function parseDirectiveAttributes(raw) {
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_]+)="([^"]*)"/g;
  for (const match of raw.matchAll(attrRe)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function resolveExamplePackageDir(repoRoot, packageRef) {
  if (!packageRef || typeof packageRef !== "string") {
    throw new Error("DOCS:EXAMPLE requires package=\"...\".");
  }

  if (packageRef.startsWith("docs/examples/")) {
    return {
      packageDir: path.resolve(repoRoot, packageRef),
      normalizedPackageRef: packageRef
    };
  }

  return {
    packageDir: path.resolve(repoRoot, "docs/examples", packageRef),
    normalizedPackageRef: packageRef
  };
}

function resolveExampleSourcePath({ repoRoot, attrs }) {
  const { package: packageRef } = attrs;
  const { packageDir, normalizedPackageRef } = resolveExamplePackageDir(repoRoot, packageRef);

  if (typeof attrs.file === "string" && attrs.file.trim().length > 0) {
    return {
      sourcePath: path.resolve(packageDir, attrs.file),
      packageRef: normalizedPackageRef,
      artifactKey: "file",
      artifactValue: attrs.file
    };
  }

  const artifactKeys = Object.keys(EXAMPLE_ARTIFACT_PATHS).filter(
    (key) => typeof attrs[key] === "string" && attrs[key].trim().length > 0
  );

  if (artifactKeys.length === 0) {
    throw new Error(
      "DOCS:EXAMPLE requires one of controller/provider/service/action/repository/schema/file."
    );
  }

  if (artifactKeys.length > 1) {
    throw new Error("DOCS:EXAMPLE supports only one artifact selector at a time.");
  }

  const artifactKey = artifactKeys[0];
  const artifactValue = attrs[artifactKey].trim();
  const fileName = artifactValue.endsWith(".js") ? artifactValue : `${artifactValue}.js`;
  const sourcePath = path.resolve(packageDir, EXAMPLE_ARTIFACT_PATHS[artifactKey], fileName);

  return {
    sourcePath,
    packageRef: normalizedPackageRef,
    artifactKey,
    artifactValue
  };
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function extractSnippetBody(sourcePath, snippetName) {
  const sourceText = normalizeNewlines(await fs.readFile(sourcePath, "utf8"));
  const lines = sourceText.split("\n");
  const startMarker = `docs:start:${snippetName}`;
  const endMarker = `docs:end:${snippetName}`;

  const startIndex = lines.findIndex((line) =>
    new RegExp(`^\\s*//\\s*${escapeRegExp(startMarker)}\\s*$`).test(line)
  );

  if (startIndex < 0) {
    throw new Error(`Missing marker // ${startMarker}`);
  }

  const endIndex = lines.findIndex(
    (line, index) =>
      index > startIndex && new RegExp(`^\\s*//\\s*${escapeRegExp(endMarker)}\\s*$`).test(line)
  );

  if (endIndex < 0) {
    throw new Error(`Missing marker // ${endMarker}`);
  }

  return lines.slice(startIndex + 1, endIndex).join("\n");
}

function buildNormalizedBlock({ source, snippet, lang, snippetBody }) {
  const language = String(lang || "js").trim() || "js";
  return [
    `<!-- DOCS:SYNC source="${source}" snippet="${snippet}" lang="${language}" -->`,
    `\`\`\`${language}`,
    snippetBody,
    "```",
    "<!-- /DOCS:SYNC -->"
  ].join("\n");
}

function buildNormalizedExampleBlock({
  packageRef,
  artifactKey,
  artifactValue,
  lang,
  sourceBody
}) {
  const language = String(lang || "js").trim() || "js";
  const header = `<!-- DOCS:EXAMPLE package="${packageRef}" ${artifactKey}="${artifactValue}" lang="${language}" -->`;
  return [header, `\`\`\`${language}`, sourceBody, "```", "<!-- /DOCS:EXAMPLE -->"].join("\n");
}

function collectSyncBlocks(markdownText) {
  const blocks = [];

  for (const match of markdownText.matchAll(SYNC_BLOCK_RE)) {
    blocks.push({
      fullMatch: match[0],
      source: match[1],
      snippet: match[2],
      langAttr: match[3],
      fenceLang: match[4],
      body: match[5],
      start: match.index,
      end: (match.index || 0) + match[0].length
    });
  }

  return blocks;
}

function collectExampleBlocks(markdownText) {
  const blocks = [];

  for (const match of markdownText.matchAll(EXAMPLE_BLOCK_RE)) {
    const attrs = parseDirectiveAttributes(match[1]);
    blocks.push({
      type: "example",
      fullMatch: match[0],
      attrs,
      langAttr: attrs.lang,
      fenceLang: match[2],
      body: match[3],
      start: match.index,
      end: (match.index || 0) + match[0].length
    });
  }

  return blocks;
}

async function syncOneManualFile({ filePath, repoRoot }) {
  const original = normalizeNewlines(await fs.readFile(filePath, "utf8"));
  const blocks = [...collectSyncBlocks(original), ...collectExampleBlocks(original)].sort(
    (a, b) => (a.start || 0) - (b.start || 0)
  );

  if (blocks.length === 0) {
    return {
      changed: false,
      blockCount: 0,
      changedBlocks: 0,
      nextText: original,
      errors: []
    };
  }

  const fileErrors = [];
  const pieces = [];
  let cursor = 0;
  let changedBlocks = 0;

  for (const block of blocks) {
    let normalized = block.fullMatch;
    if (block.type === "example") {
      let sourceBody = block.body;
      let resolved = null;
      try {
        resolved = resolveExampleSourcePath({ repoRoot, attrs: block.attrs });
        sourceBody = normalizeNewlines(await fs.readFile(resolved.sourcePath, "utf8")).replace(/\n$/, "");
      } catch (error) {
        const label =
          resolved && resolved.sourcePath ? path.relative(repoRoot, resolved.sourcePath) : "unresolved-source";
        fileErrors.push(`${path.relative(repoRoot, filePath)} -> ${label}: ${error.message}`);
      }

      normalized = buildNormalizedExampleBlock({
        packageRef: (resolved && resolved.packageRef) || block.attrs.package || "",
        artifactKey: (resolved && resolved.artifactKey) || "file",
        artifactValue: (resolved && resolved.artifactValue) || block.attrs.file || "",
        lang: block.langAttr || block.fenceLang,
        sourceBody
      });
    } else {
      const sourcePath = path.resolve(repoRoot, block.source);

      let snippetBody;
      try {
        snippetBody = await extractSnippetBody(sourcePath, block.snippet);
      } catch (error) {
        fileErrors.push(
          `${path.relative(repoRoot, filePath)} -> ${block.source} [${block.snippet}]: ${error.message}`
        );
        snippetBody = block.body;
      }

      normalized = buildNormalizedBlock({
        source: block.source,
        snippet: block.snippet,
        lang: block.langAttr || block.fenceLang,
        snippetBody
      });
    }

    if (normalizeNewlines(block.fullMatch) !== normalizeNewlines(normalized)) {
      changedBlocks += 1;
    }

    pieces.push(original.slice(cursor, block.start || 0));
    pieces.push(normalized);
    cursor = block.end;
  }

  pieces.push(original.slice(cursor));

  const nextText = pieces.join("");

  return {
    changed: nextText !== original,
    blockCount: blocks.length,
    changedBlocks,
    nextText,
    errors: fileErrors
  };
}

export async function runSyncDocSnippets({ check = false, repoRoot = resolveRepoRoot(), quiet = false } = {}) {
  const manualDir = path.resolve(repoRoot, "docs/manual");
  const entries = await fs.readdir(manualDir, { withFileTypes: true });
  const markdownFiles = listMarkdownFiles(entries).map((name) => path.join(manualDir, name));

  const changedFiles = [];
  let totalBlocks = 0;
  let totalChangedBlocks = 0;
  const errors = [];

  for (const filePath of markdownFiles) {
    const result = await syncOneManualFile({ filePath, repoRoot });
    totalBlocks += result.blockCount;
    totalChangedBlocks += result.changedBlocks;
    errors.push(...result.errors);

    if (result.changed) {
      changedFiles.push(path.relative(repoRoot, filePath));
      if (!check && result.errors.length === 0) {
        await fs.writeFile(filePath, result.nextText, "utf8");
      }
    }
  }

  if (!quiet) {
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`[docs:sync] ${error}`);
      }
    }

    if (check) {
      if (changedFiles.length > 0) {
        console.error("[docs:sync] Out-of-sync markdown files:");
        for (const file of changedFiles) {
          console.error(`  - ${file}`);
        }
      } else {
        console.log(`[docs:sync] OK (${totalBlocks} synced block${totalBlocks === 1 ? "" : "s"}).`);
      }
    } else if (changedFiles.length > 0) {
      console.log("[docs:sync] Updated markdown files:");
      for (const file of changedFiles) {
        console.log(`  - ${file}`);
      }
      console.log(`[docs:sync] Updated ${changedFiles.length} file(s), ${totalChangedBlocks} block(s).`);
    } else {
      console.log(`[docs:sync] No changes (${totalBlocks} synced block${totalBlocks === 1 ? "" : "s"}).`);
    }
  }

  const success = errors.length === 0 && (!check || changedFiles.length === 0);

  return {
    success,
    changedFiles,
    totalBlocks,
    totalChangedBlocks,
    errors
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const result = await runSyncDocSnippets({ check });
  if (!result.success) {
    process.exitCode = 1;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[docs:sync] ${error.message}`);
    process.exitCode = 1;
  });
}
