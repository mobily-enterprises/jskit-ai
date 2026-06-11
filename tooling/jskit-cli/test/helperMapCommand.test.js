import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

function parseJsonResult(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("jskit helper-map update writes deterministic app and package helper maps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await mkdir(path.join(appRoot, "src", "lib"), {
      recursive: true
    });
    await mkdir(path.join(appRoot, "src", "pages"), {
      recursive: true
    });
    await mkdir(path.join(appRoot, "node_modules", "@jskit-ai", "sample-runtime"), {
      recursive: true
    });
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "helper-map-app",
          version: "0.1.0",
          type: "module",
          dependencies: {
            "@jskit-ai/sample-runtime": "0.1.0"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "lib", "formatTitle.js"),
      "export function formatTitle(value) {\n  return String(value).trim();\n}\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "lib", "names.js"),
      "export const normalizeName = (value) => String(value).trim().toLowerCase();\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "lib", "index.js"),
      "export { normalizeName as normalizeHelperName } from './names.js';\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home.vue"),
      "<script>\nexport function useHomePageTitle() {\n  return 'Home';\n}\n</script>\n<template><main>Home</main></template>\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "node_modules", "@jskit-ai", "sample-runtime", "package.json"),
      `${JSON.stringify(
        {
          name: "@jskit-ai/sample-runtime",
          version: "0.1.0",
          type: "module",
          exports: {
            ".": "./index.js",
            "./helpers": "./helpers.js"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "node_modules", "@jskit-ai", "sample-runtime", "index.js"),
      "export function createSampleRuntime() {}\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "node_modules", "@jskit-ai", "sample-runtime", "helpers.js"),
      "export const sampleMap = new Map();\n",
      "utf8"
    );

    const updated = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["helper-map", "update", "--json"]
    }));
    assert.equal(updated.ok, true);
    assert.equal(updated.changed, true);
    assert.equal(updated.map.generatedBy, "jskit helper-map update");
    assert.equal(updated.map.schemaVersion, 2);
    assert.ok(updated.map.app.files.some((file) => {
      return file.path === "src/lib/formatTitle.js" &&
        file.exports.some((symbol) => symbol.name === "formatTitle" && symbol.kind === "function");
    }));
    assert.ok(updated.map.app.files.some((file) => {
      return file.path === "src/lib/index.js" &&
        file.exports.some((symbol) => symbol.name === "normalizeHelperName" && symbol.kind === "export");
    }));
    assert.ok(updated.map.app.files.some((file) => {
      return file.path === "src/pages/home.vue" &&
        file.exports.some((symbol) => symbol.name === "useHomePageTitle" && symbol.role === "composable");
    }));
    assert.equal(updated.map.jskitPackages[0].name, "@jskit-ai/sample-runtime");
    assert.match(updated.map.jskitPackages[0].fingerprint, /^[a-f0-9]{64}$/u);
    assert.ok(updated.map.jskitPackages[0].exports.some((entry) => {
      return entry.exports.some((symbol) => symbol.name === "createSampleRuntime");
    }));

    const markdown = await readFile(path.join(appRoot, ".jskit", "helper-map.md"), "utf8");
    assert.match(markdown, /formatTitle/);
    assert.match(markdown, /normalizeHelperName/);
    assert.match(markdown, /useHomePageTitle/);
    assert.match(markdown, /createSampleRuntime/);

    const second = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["helper-map", "update", "--json"]
    }));
    assert.equal(second.changed, false);

    await writeFile(
      path.join(appRoot, "node_modules", "@jskit-ai", "sample-runtime", "helpers.js"),
      [
        "export const sampleMap = new Map();",
        "export function buildSampleHelper() {",
        "  return sampleMap;",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );

    const packageExportChanged = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["helper-map", "update", "--json"]
    }));
    assert.equal(packageExportChanged.changed, true);
    assert.ok(packageExportChanged.map.jskitPackages[0].exports.some((entry) => {
      return entry.subpath === "./helpers" &&
        entry.exports.some((symbol) => symbol.name === "buildSampleHelper" && symbol.kind === "function");
    }));

    const read = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["helper-map", "--json"]
    }));
    assert.equal(read.exists, true);
    assert.equal(read.map.rootPackage.name, "helper-map-app");
  });
});
