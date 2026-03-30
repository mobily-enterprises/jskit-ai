import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/container.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-container-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeAppFixture(appRoot) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
    admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true }
  }
};
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "components", "ShellLayout.vue"),
    `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="shell-layout" position="top-right" />
  </div>
</template>
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "placement.js"),
    `function addPlacement() {}

export { addPlacement };
export default function getPlacements() {
  return [];
}
`,
    "utf8"
  );
}

test("ui-generator container subcommand creates parent route container with ShellOutlet and RouterView", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "container",
      options: {
        name: "Practice",
        surface: "admin"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "src/pages/w/[workspaceSlug]/admin/practice.vue",
      "src/placement.js"
    ]);

    const containerSource = await readFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "practice.vue"),
      "utf8"
    );
    assert.match(containerSource, /<ShellOutlet host="practice" position="sub-pages" \/>/);
    assert.match(containerSource, /<RouterView \/>/);
    assert.match(containerSource, /"surface": "admin"/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.container\.practice\.menu"/);
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "primary-menu"/);
    assert.match(placementSource, /workspaceSuffix: "\/practice"/);
  });
});
