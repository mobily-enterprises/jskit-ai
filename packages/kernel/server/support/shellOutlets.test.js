import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  discoverShellOutletTargetsFromApp,
  resolveShellOutletPlacementTargetFromApp
} from "./shellOutlets.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "kernel-shell-outlets-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeFileInApp(appRoot, relativePath, source) {
  const absoluteFilePath = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFilePath), { recursive: true });
  await writeFile(absoluteFilePath, source, "utf8");
}

test("resolveShellOutletPlacementTargetFromApp reads outlets across app Vue files", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" />
    <ShellOutlet host="shell-layout" position="top-right" />
  </div>
</template>
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/admin/workspace/settings/index.vue",
      `<template>
  <section>
    <ShellOutlet host="admin-settings" position="forms" default />
  </section>
</template>
`
    );

    const target = await resolveShellOutletPlacementTargetFromApp({
      appRoot,
      context: "ui-generator"
    });

    assert.equal(target.host, "admin-settings");
    assert.equal(target.position, "forms");
  });
});

test("discoverShellOutletTargetsFromApp includes installed package placement outlets", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
  </div>
</template>
`
    );
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

    const discovered = await discoverShellOutletTargetsFromApp({ appRoot });
    assert.deepEqual(
      discovered.targets.map((entry) => entry.id),
      ["shell-layout:primary-menu", "workspace-tools:primary-menu"]
    );
    assert.deepEqual(discovered.targets[1], {
      id: "workspace-tools:primary-menu",
      host: "workspace-tools",
      position: "primary-menu",
      default: false,
      sourcePath: "package:@example/users-web:src/client/components/UsersWorkspaceToolsWidget.vue",
      sourcePackageId: "@example/users-web"
    });

    const target = await resolveShellOutletPlacementTargetFromApp({
      appRoot,
      placement: "workspace-tools:primary-menu",
      context: "ui-generator"
    });
    assert.equal(target.id, "workspace-tools:primary-menu");
  });
});

test("discoverShellOutletTargetsFromApp returns targets with sourcePath and default marker", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" />
  </div>
</template>
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/admin/workspace/settings/index.vue",
      `<template>
  <section>
    <ShellOutlet host="admin-settings" position="forms" default />
  </section>
</template>
`
    );

    const discovered = await discoverShellOutletTargetsFromApp({ appRoot });
    assert.equal(discovered.defaultTargetId, "admin-settings:forms");
    assert.deepEqual(discovered.targets, [
      {
        id: "admin-settings:forms",
        host: "admin-settings",
        position: "forms",
        default: true,
        sourcePath: "src/pages/admin/workspace/settings/index.vue"
      },
      {
        id: "shell-layout:primary-menu",
        host: "shell-layout",
        position: "primary-menu",
        default: false,
        sourcePath: "src/components/ShellLayout.vue"
      }
    ]);
  });
});

test("discoverShellOutletTargetsFromApp discovers route meta placement outlets", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/contact-tools.vue",
      `<template><section /></template>

<route lang="json">
{
  "meta": {
    "jskit": {
      "placements": {
        "outlets": [
          {
            "host": "contact-tools",
            "position": "sub-pages"
          }
        ]
      }
    }
  }
}
</route>
`
    );

    const discovered = await discoverShellOutletTargetsFromApp({ appRoot });
    assert.deepEqual(discovered.targets, [
      {
        id: "contact-tools:sub-pages",
        host: "contact-tools",
        position: "sub-pages",
        default: false,
        sourcePath: "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/contact-tools.vue"
      }
    ]);

    const target = await resolveShellOutletPlacementTargetFromApp({
      appRoot,
      placement: "contact-tools:sub-pages",
      context: "ui-generator"
    });
    assert.equal(target.id, "contact-tools:sub-pages");
  });
});

test("resolveShellOutletPlacementTargetFromApp supports explicit placement override", async () => {
  await withTempApp(async (appRoot) => {
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

    const target = await resolveShellOutletPlacementTargetFromApp({
      appRoot,
      context: "ui-generator",
      placement: "shell-layout:top-right"
    });

    assert.equal(target.host, "shell-layout");
    assert.equal(target.position, "top-right");
  });
});

test("resolveShellOutletPlacementTargetFromApp validates placement format", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
  </div>
</template>
`
    );

    await assert.rejects(
      () =>
        resolveShellOutletPlacementTargetFromApp({
          appRoot,
          context: "ui-generator",
          placement: "invalid-placement"
        }),
      /option "placement" must be in "host:position" format/
    );
  });
});

test("resolveShellOutletPlacementTargetFromApp throws when multiple default outlets exist", async () => {
  await withTempApp(async (appRoot) => {
    await writeFileInApp(
      appRoot,
      "src/components/ShellLayout.vue",
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
  </div>
</template>
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/admin/workspace/settings/index.vue",
      `<template>
  <section>
    <ShellOutlet host="admin-settings" position="forms" default />
  </section>
</template>
`
    );

    await assert.rejects(
      () =>
        resolveShellOutletPlacementTargetFromApp({
          appRoot,
          context: "ui-generator"
        }),
      /Multiple default ShellOutlet targets found in app source/
    );
  });
});

test("resolveShellOutletPlacementTargetFromApp requires appRoot", async () => {
  await assert.rejects(
    () =>
      resolveShellOutletPlacementTargetFromApp({
        appRoot: "",
        context: "ui-generator"
      }),
    /requires appRoot/
  );
});
