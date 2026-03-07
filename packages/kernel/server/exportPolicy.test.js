import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectExportTargets(exportsField) {
  const targets = [];

  const visit = (value) => {
    if (typeof value === "string") {
      targets.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };

  visit(exportsField);
  return [...new Set(targets)];
}

function parseNamedExportSpecifiers(specifierSource) {
  return String(specifierSource || "")
    .split(",")
    .map((entry) => entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/g, "").trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+/g, " "))
    .map((entry) => {
      const aliasMatch = /^(.+?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(entry);
      return aliasMatch ? aliasMatch[2] : entry;
    })
    .filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry));
}

function parseExportedSymbolsFromSource(source) {
  const symbols = new Set();
  const namedPattern = /export\s*\{([\s\S]*?)\}\s*(?:from\s*["'][^"']+["'])?\s*;?/g;
  let match = namedPattern.exec(source);
  while (match) {
    for (const symbol of parseNamedExportSpecifiers(match[1])) {
      symbols.add(symbol);
    }
    match = namedPattern.exec(source);
  }
  return [...symbols].sort((left, right) => left.localeCompare(right));
}

test("kernel exported JS targets do not use star re-exports", async () => {
  const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const exportTargets = collectExportTargets(packageJson.exports);
  const exportedJsTargets = exportTargets
    .filter((target) => typeof target === "string")
    .filter((target) => target.startsWith("./"))
    .filter((target) => target.endsWith(".js"))
    .filter((target) => !target.includes("*"));

  const violations = [];
  for (const target of exportedJsTargets) {
    const absolutePath = path.join(PACKAGE_ROOT, target.slice(2));
    const source = await readFile(absolutePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || "");
      if (/^\s*export\s+\*\s+from\s+["'][^"']+["']\s*;?\s*$/.test(line)) {
        violations.push(`${target}:${index + 1}`);
      }
      if (/^\s*export\s+\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+["'][^"']+["']\s*;?\s*$/.test(line)) {
        violations.push(`${target}:${index + 1}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("kernel server aggregate entrypoint remains provider-only", async () => {
  const source = await readFile(path.join(PACKAGE_ROOT, "server/index.js"), "utf8");
  const symbols = parseExportedSymbolsFromSource(source);
  assert.deepEqual(symbols, [
    "ContainerCoreServiceProvider",
    "HttpFastifyServiceProvider",
    "KernelCoreServiceProvider",
    "PlatformServerRuntimeServiceProvider",
    "ServerRuntimeCoreServiceProvider",
    "SupportCoreServiceProvider",
    "SurfaceRoutingServiceProvider"
  ]);
});
