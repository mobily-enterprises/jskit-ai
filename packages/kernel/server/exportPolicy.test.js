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

test("kernel package does not expose deprecated ./server aggregate entrypoint", async () => {
  const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  assert.equal(Object.hasOwn(packageJson.exports || {}, "./server"), false);
});
