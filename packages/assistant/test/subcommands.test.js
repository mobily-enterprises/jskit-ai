import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand as runPageSubcommand } from "../src/server/subcommands/page.js";
import { runGeneratorSubcommand as runSettingsPageSubcommand } from "../src/server/subcommands/settingsPage.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "assistant-subcommands-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeFileInApp(appRoot, relativePath, source) {
  const absoluteFile = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

async function writeAppFixture(appRoot) {
  await writeFileInApp(
    appRoot,
    "config/public.js",
    `export const config = {
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "w/[workspaceSlug]/admin",
      enabled: true,
      requiresWorkspace: true,
      accessPolicyId: "workspace_member"
    },
    console: {
      id: "console",
      pagesRoot: "console",
      enabled: true,
      requiresWorkspace: false,
      accessPolicyId: "console_owner"
    }
  },
  assistantSurfaces: {}
};
`
  );
  await writeFileInApp(
    appRoot,
    "src/components/ShellLayout.vue",
    `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="shell-layout" position="top-right" />
  </div>
</template>
`
  );
  await writeFileInApp(
    appRoot,
    "src/placement.js",
    `function addPlacement() {}

export { addPlacement };
export default function getPlacements() {
  return [];
}
`
  );
}

test("assistant page subcommand creates a runtime page at an explicit target file", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/ops/copilot/index.vue";
    const result = await runPageSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [targetFile, "src/placement.js"]);

    const pageSource = await readFile(path.join(appRoot, targetFile), "utf8");
    assert.match(pageSource, /<AssistantSurfaceClientElement surface-id="admin" \/>/);

    const placementSource = await readFile(path.join(appRoot, "src/placement.js"), "utf8");
    assert.match(placementSource, /jskit:assistant\.page\.link:admin:\/ops\/copilot/);
    assert.match(placementSource, /id: "ui-generator\.page\.ops\.copilot\.link"/);
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "primary-menu"/);
    assert.match(placementSource, /label: "Copilot"/);
    assert.match(placementSource, /workspaceSuffix: "\/ops\/copilot"/);
  });
});

test("assistant settings-page subcommand uses the target assistant surface and infers parent subpage placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/w/[workspaceSlug]/admin/settings/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="admin-settings" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const targetFile = "src/pages/w/[workspaceSlug]/admin/settings/(nestedChildren)/assistant/index.vue";
    const result = await runSettingsPageSubcommand({
      appRoot,
      subcommand: "settings-page",
      args: [targetFile],
      options: {
        surface: "console"
      }
    });

    assert.deepEqual(result.touchedFiles, [targetFile, "src/placement.js"]);

    const pageSource = await readFile(path.join(appRoot, targetFile), "utf8");
    assert.match(pageSource, /<AssistantSettingsClientElement target-surface-id="console" \/>/);

    const placementSource = await readFile(path.join(appRoot, "src/placement.js"), "utf8");
    assert.match(placementSource, /jskit:assistant\.settings-page\.link:admin:\/settings\/assistant:console/);
    assert.match(placementSource, /host: "admin-settings"/);
    assert.match(placementSource, /position: "sub-pages"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/assistant"/);
    assert.match(placementSource, /label: "Assistant"/);
  });
});

test("assistant page subcommand refuses to overwrite an existing user-owned page", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/assistant/index.vue";
    await writeFileInApp(
      appRoot,
      targetFile,
      `<template>
  <div>custom page</div>
</template>
`
    );

    await assert.rejects(
      () =>
        runPageSubcommand({
          appRoot,
          subcommand: "page",
          args: [targetFile],
          options: {}
        }),
      /will not overwrite existing page/
    );
  });
});

test("assistant settings-page subcommand requires the target assistant surface option", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await assert.rejects(
      () =>
        runSettingsPageSubcommand({
          appRoot,
          subcommand: "settings-page",
          args: ["src/pages/w/[workspaceSlug]/admin/settings/assistant/index.vue"],
          options: {}
        }),
      /assistant generator requires --surface/
    );
  });
});
