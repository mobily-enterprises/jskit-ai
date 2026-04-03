import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildUiPageTemplateContext } from "../src/server/buildTemplateContext.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeVueFile(appRoot, relativePath, source = "") {
  const absoluteFile = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(
    absoluteFile,
    source ||
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
  </div>
</template>
`,
    "utf8"
  );
}

test("buildUiPageTemplateContext resolves placement from default app ShellOutlet target", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" />
  </div>
</template>
`
    );
    await writeVueFile(
      appRoot,
      "src/pages/admin/workspace/settings/index.vue",
      `<template>
  <section>
    <ShellOutlet host="workspace-settings" position="forms" default />
  </section>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      options: {}
    });
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_HOST__, "workspace-settings");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "forms");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "users.web.shell.surface-aware-menu-link-item");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/");
    assert.equal(context.__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__, "/");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "");
  });
});

test("buildUiPageTemplateContext supports explicit placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(appRoot, "src/components/ShellLayout.vue");

    const context = await buildUiPageTemplateContext({
      appRoot,
      options: {
        placement: "shell-layout:top-right"
      }
    });
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "top-right");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "users.web.shell.surface-aware-menu-link-item");
  });
});

test("buildUiPageTemplateContext supports explicit package outlet placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(appRoot, "src/components/ShellLayout.vue");
    await writeVueFile(
      appRoot,
      ".jskit/lock.json",
      `${JSON.stringify(
        {
          lockVersion: 1,
          installedPackages: {
            "@example/users-web": {
              packageId: "@example/users-web",
              source: {
                type: "npm-installed-package",
                descriptorPath: "node_modules/@example/users-web/package.descriptor.mjs"
              }
            }
          }
        },
        null,
        2
      )}\n`
    );
    await writeVueFile(
      appRoot,
      "node_modules/@example/users-web/package.descriptor.mjs",
      `export default {
  packageId: "@example/users-web",
  metadata: {
    ui: {
      placements: {
        outlets: [
          { host: "workspace-tools", position: "primary-menu", source: "src/client/components/UsersWorkspaceToolsWidget.vue" }
        ]
      }
    }
  }
};
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      options: {
        placement: "workspace-tools:primary-menu"
      }
    });
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_HOST__, "workspace-tools");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "primary-menu");
  });
});

test("buildUiPageTemplateContext supports explicit placement token and placement to", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(appRoot, "src/components/ShellLayout.vue");

    const context = await buildUiPageTemplateContext({
      appRoot,
      options: {
        name: "Notes",
        "directory-prefix": "contacts/[contactId]/(nestedChildren)",
        placement: "shell-layout:top-right",
        "placement-component-token": "local.main.ui.tab-link-item",
        "placement-to": "./notes"
      }
    });
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./notes\",\n");
  });
});

test("buildUiPageTemplateContext auto sets relative placement to for nestedChildren prefixes", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(appRoot, "src/components/ShellLayout.vue");

    const context = await buildUiPageTemplateContext({
      appRoot,
      options: {
        name: "Notes",
        "directory-prefix": "contacts/[contactId]/(nestedChildren)",
        placement: "shell-layout:top-right"
      }
    });
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./notes\",\n");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
  });
});

test("buildUiPageTemplateContext validates placement format", async () => {
  await withTempApp(async (appRoot) => {
    await writeVueFile(appRoot, "src/components/ShellLayout.vue");

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          options: {
            placement: "invalid-placement"
          }
        }),
      /option "placement" must be in "host:position" format/
    );
  });
});
