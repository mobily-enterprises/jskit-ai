import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");
const CREATE_APP_TEMPLATE_DIR = path.resolve(PACKAGE_DIR, "..", "..", "tooling", "create-app", "templates", "base-shell");

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web claims starter shell files as app-owned scaffolds", () => {
  assert.deepEqual(findFileMutation("shell-web-app-root"), {
    from: "templates/src/App.vue",
    to: "src/App.vue",
    ownership: "app",
    expectedExistingFrom: "templates/expected-existing/src/App.vue",
    reason: "Install full-width shell app root with shell-web error host and edge-to-edge layout.",
    category: "shell-web",
    id: "shell-web-app-root"
  });
  assert.deepEqual(findFileMutation("shell-web-page-home-wrapper"), {
    from: "templates/src/pages/home.vue",
    toSurface: "home",
    toSurfaceRoot: true,
    ownership: "app",
    expectedExistingFrom: "templates/expected-existing/src/pages/home.vue",
    reason: "Install shell-driven home wrapper page.",
    category: "shell-web",
    id: "shell-web-page-home-wrapper"
  });
  assert.deepEqual(findFileMutation("shell-web-page-home"), {
    from: "templates/src/pages/home/index.vue",
    toSurface: "home",
    toSurfacePath: "index.vue",
    ownership: "app",
    expectedExistingFrom: "templates/expected-existing/src/pages/home/index.vue",
    reason: "Install shell-driven home surface starter page.",
    category: "shell-web",
    id: "shell-web-page-home"
  });
});

test("shell-web expected-existing starter files stay aligned with create-app base-shell", async () => {
  const comparedFiles = [
    "src/App.vue",
    "src/pages/home.vue",
    "src/pages/home/index.vue"
  ];

  for (const relativeFile of comparedFiles) {
    const shellWebExpectedSource = await readFile(
      path.join(PACKAGE_DIR, "templates", "expected-existing", relativeFile),
      "utf8"
    );
    const createAppSource = await readFile(path.join(CREATE_APP_TEMPLATE_DIR, relativeFile), "utf8");
    assert.equal(shellWebExpectedSource, createAppSource, relativeFile);
  }
});
