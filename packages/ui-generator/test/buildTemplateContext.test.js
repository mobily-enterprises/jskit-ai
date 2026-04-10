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

async function writeFileInApp(appRoot, relativePath, source) {
  const absoluteFile = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

async function writeConfig(appRoot, source) {
  await writeFileInApp(appRoot, "config/public.js", source);
}

async function writeShellLayout(appRoot, source = "") {
  await writeFileInApp(
    appRoot,
    "src/components/ShellLayout.vue",
    source ||
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
  </div>
</template>
`
  );
}

test("buildUiPageTemplateContext resolves link placement from default app ShellOutlet target", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/reports/index.vue",
      options: {}
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "shell-layout");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "primary-menu");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "users.web.shell.surface-aware-menu-link-item");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/reports");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/reports");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.reports.link");
  });
});

test("buildUiPageTemplateContext supports explicit link placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/reports/index.vue",
      options: {
        "link-placement": "shell-layout:top-right"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "top-right");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "users.web.shell.surface-aware-menu-link-item");
  });
});

test("buildUiPageTemplateContext supports explicit package outlet link placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
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
    await writeFileInApp(
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
      targetFile: "src/pages/admin/reports/index.vue",
      options: {
        "link-placement": "workspace-tools:primary-menu"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "workspace-tools");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "primary-menu");
  });
});

test("buildUiPageTemplateContext supports explicit link component token and link-to", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/contacts/[contactId]/(nestedChildren)/notes/index.vue",
      options: {
        "link-placement": "shell-layout:top-right",
        "link-component-token": "local.main.ui.tab-link-item",
        "link-to": "./notes"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes\",\n");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.contacts.contact-id.notes.link");
  });
});

test("buildUiPageTemplateContext auto sets relative link-to for nestedChildren routes", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/contacts/[contactId]/(nestedChildren)/notes/index.vue",
      options: {
        "link-placement": "shell-layout:top-right"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes\",\n");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
  });
});

test("buildUiPageTemplateContext infers subpage link placement, tab token, and link-to from a file-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/contacts/[contactId].vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="contact-view" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/contacts/[contactId]/notes/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "contact-view");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "sub-pages");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes\",\n");
  });
});

test("buildUiPageTemplateContext inherits a file-route parent host for deeper descendants", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/contacts/[contactId].vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="contact-view" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/contacts/[contactId]/notes/history/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "contact-view");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "sub-pages");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes/history\",\n");
  });
});

test("buildUiPageTemplateContext infers subpage link placement from an index-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="catalog" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/catalog/(nestedChildren)/products/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "catalog");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "sub-pages");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./products\",\n");
  });
});

test("buildUiPageTemplateContext finds the nearest nestedChildren parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="catalog" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/(nestedChildren)/products/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="catalog-products" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/catalog/(nestedChildren)/products/(nestedChildren)/variants/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_HOST__, "catalog-products");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_POSITION__, "sub-pages");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./variants\",\n");
  });
});

test("buildUiPageTemplateContext derives the same visible route from file and index page shapes", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const fileContext = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/catalog.vue",
      options: {}
    });
    const indexContext = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/catalog/index.vue",
      options: {}
    });

    assert.equal(fileContext.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/catalog");
    assert.equal(indexContext.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/catalog");
    assert.equal(fileContext.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.catalog.link");
    assert.equal(indexContext.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.catalog.link");
  });
});

test("buildUiPageTemplateContext fails when the target file is outside src/pages", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "src/components/ReportsPanel.vue",
          options: {}
        }),
      /target file must live under src\/pages\//
    );
  });
});

test("buildUiPageTemplateContext fails when the target file matches no surface", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "src/pages/reports/index.vue",
          options: {}
        }),
      /does not belong to any configured surface pagesRoot/
    );
  });
});

test("buildUiPageTemplateContext fails when the target file matches multiple surfaces", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "", enabled: true },
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "src/pages/admin/reports/index.vue",
          options: {}
        }),
      /matches multiple surfaces \(app, admin\)/
    );
  });
});

test("buildUiPageTemplateContext validates link placement format", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "src/pages/admin/reports/index.vue",
          options: {
            "link-placement": "invalid-placement"
          }
        }),
      /option "placement" must be in "host:position" format/
    );
  });
});
