import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findTextMutation(id) {
  const text = descriptor?.mutations?.text;
  return Array.isArray(text)
    ? text.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("console-web installs console surface scripts and files", () => {
  assert.deepEqual(descriptor?.mutations?.packageJson?.scripts, {
    "server:console": "SERVER_SURFACE=console node ./bin/server.js",
    "dev:console": "VITE_SURFACE=console vite",
    "build:console": "VITE_SURFACE=console vite build"
  });
  assert.deepEqual(findFileMutation("console-web-page-console-wrapper"), {
    from: "templates/src/pages/console.vue",
    toSurface: "console",
    toSurfaceRoot: true,
    ownership: "app",
    reason: "Install shell-driven console wrapper page.",
    category: "console-web",
    id: "console-web-page-console-wrapper"
  });
  assert.deepEqual(findFileMutation("console-web-page-console"), {
    from: "templates/src/pages/console/index.vue",
    toSurface: "console",
    toSurfacePath: "index.vue",
    ownership: "app",
    reason: "Install shell-driven console page starter.",
    category: "console-web",
    id: "console-web-page-console"
  });
});

test("console-web wires console surface policy into app config", () => {
  assert.equal(
    findTextMutation("console-web-surface-access-policies-console-owner")?.file,
    "config/surfaceAccessPolicies.js"
  );
  assert.equal(findTextMutation("console-web-surface-config-console")?.file, "config/public.js");
  assert.match(findTextMutation("console-web-surface-config-console")?.value || "", /accessPolicyId: "console_owner"/);
});

test("console-web console templates stay shell-driven", async () => {
  const wrapperSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console.vue"), "utf8");
  const indexSource = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "index.vue"), "utf8");

  assert.match(wrapperSource, /ShellLayout/);
  assert.match(wrapperSource, /"surface": "console"/);
  assert.match(indexSource, /Operations Console/);
});
