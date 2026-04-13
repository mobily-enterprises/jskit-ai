import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/page.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-page-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

function toPagePath(targetFile = "") {
  return path.join("src/pages", targetFile);
}

async function writeAppFixture(appRoot, { configSource = "" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    configSource ||
      `export const config = {
  surfaceDefinitions: {
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
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
    <ShellOutlet target="shell-layout:top-right" />
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

test("ui-generator page subcommand creates an index page from an explicit target file", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {
        name: "Practice"
      }
    });

    assert.deepEqual(result.touchedFiles, [toPagePath(targetFile), "src/placement.js"]);
    assert.equal(result.summary, 'Generated UI page "/practice" at src/pages/w/[workspaceSlug]/admin/practice/index.vue.');

    const pageSource = await readFile(path.join(appRoot, toPagePath(targetFile)), "utf8");
    assert.match(pageSource, /<h1 class="text-h5 mb-2">Practice<\/h1>/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.practice\.link"/);
    assert.match(placementSource, /workspaceSuffix: "\/practice"/);
    assert.match(placementSource, /label: "Practice"/);
  });
});

test("ui-generator page subcommand creates a file route and derives label from the file path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/contacts/[contactId].vue";
    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [toPagePath(targetFile), "src/placement.js"]);

    const pageSource = await readFile(path.join(appRoot, toPagePath(targetFile)), "utf8");
    assert.match(pageSource, /<h1 class="text-h5 mb-2">Contact Id<\/h1>/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /workspaceSuffix: "\/contacts\/\[contactId\]"/);
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.contacts\.contact-id\.link"/);
    assert.match(placementSource, /label: "Contact Id"/);
  });
});

test("ui-generator page subcommand supports link placement options", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/contacts/[contactId]/index/notes/index.vue";
    await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {
        "link-placement": "shell-layout:top-right",
        "link-component-token": "local.main.ui.tab-link-item",
        "link-to": "./notes"
      }
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "shell-layout:top-right"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/notes"/);
  });
});

test("ui-generator page subcommand infers subpage link placement, tab token, and link-to from the nearest parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const parentFile = "w/[workspaceSlug]/admin/contacts/[contactId].vue";
    await mkdir(path.dirname(path.join(appRoot, toPagePath(parentFile))), { recursive: true });
    await writeFile(
      path.join(appRoot, toPagePath(parentFile)),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="contact-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );

    const targetFile = "w/[workspaceSlug]/admin/contacts/[contactId]/notes/index.vue";
    await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {}
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "contact-view:sub-pages"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/notes"/);
  });
});

test("ui-generator page subcommand prefers the nearest index-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await mkdir(path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/catalog/index/products"), {
      recursive: true
    });
    await writeFile(
      path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/catalog/index.vue"),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/catalog/index/products/index.vue"),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog-products:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );

    const targetFile =
      "w/[workspaceSlug]/admin/catalog/index/products/index/variants/index.vue";
    await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {}
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "catalog-products:sub-pages"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/variants"/);
  });
});

test("ui-generator page subcommand chooses the most specific matching surface pagesRoot", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot, {
      configSource: `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
    admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true }
  }
};
`
    });

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [toPagePath(targetFile), "src/placement.js"]);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.practice\.link"/);
    assert.match(placementSource, /workspaceSuffix: "\/practice"/);
  });
});

test("ui-generator page subcommand rejects unsupported options", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "page",
        args: ["w/[workspaceSlug]/admin/practice/index.vue"],
        options: {
          bogus: "true"
        }
      }),
      /ui-generator page received unsupported option: --bogus\./
    );
  });
});

test("ui-generator page subcommand rejects target files with a src/pages prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "page",
        args: ["src/pages/w/[workspaceSlug]/admin/practice/index.vue"],
        options: {}
      }),
      /must be relative to src\/pages\/, without the src\/pages\/ prefix/
    );
  });
});

test("ui-generator page subcommand refuses to overwrite an existing page without --force", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await mkdir(path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/practice"), {
      recursive: true
    });
    await writeFile(
      path.join(appRoot, toPagePath(targetFile)),
      `<template>
  <div>custom practice page</div>
</template>
`,
      "utf8"
    );

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "page",
        args: [targetFile],
        options: {
          name: "Practice"
        }
      }),
      /ui-generator page will not overwrite existing page src\/pages\/w\/\[workspaceSlug\]\/admin\/practice\/index\.vue\. Re-run with --force to overwrite it\./
    );

    const pageSource = await readFile(path.join(appRoot, toPagePath(targetFile)), "utf8");
    assert.match(pageSource, /custom practice page/);
  });
});

test("ui-generator page subcommand overwrites an existing page when --force is passed", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await mkdir(path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/practice"), {
      recursive: true
    });
    await writeFile(
      path.join(appRoot, toPagePath(targetFile)),
      `<template>
  <div>custom practice page</div>
</template>
`,
      "utf8"
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "page",
      args: [targetFile],
      options: {
        name: "Practice",
        force: "true"
      }
    });

    assert.deepEqual(result.touchedFiles, [toPagePath(targetFile), "src/placement.js"]);
    assert.equal(result.summary, 'Regenerated UI page "/practice" at src/pages/w/[workspaceSlug]/admin/practice/index.vue.');

    const pageSource = await readFile(path.join(appRoot, toPagePath(targetFile)), "utf8");
    assert.match(pageSource, /<h1 class="text-h5 mb-2">Practice<\/h1>/);
    assert.doesNotMatch(pageSource, /custom practice page/);
  });
});

test("ui-generator page subcommand rejects invalid link placement before creating a new page", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    const placementPath = path.join(appRoot, "src", "placement.js");
    const originalPlacementSource = await readFile(placementPath, "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "page",
        args: [targetFile],
        options: {
          "link-placement": "missing:target"
        }
      }),
      /ui-generator page option "placement" target "missing:target" is not declared/
    );

    await assert.rejects(readFile(path.join(appRoot, toPagePath(targetFile)), "utf8"), /ENOENT/);
    const placementSource = await readFile(placementPath, "utf8");
    assert.equal(placementSource, originalPlacementSource);
  });
});

test("ui-generator page subcommand rejects invalid link placement before overwriting an existing page", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    const targetPath = path.join(appRoot, toPagePath(targetFile));
    const originalPageSource = `<template>
  <div>custom practice page</div>
</template>
`;
    const placementPath = path.join(appRoot, "src", "placement.js");
    const originalPlacementSource = await readFile(placementPath, "utf8");

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, originalPageSource, "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "page",
        args: [targetFile],
        options: {
          force: "true",
          "link-placement": "missing:target"
        }
      }),
      /ui-generator page option "placement" target "missing:target" is not declared/
    );

    const pageSource = await readFile(targetPath, "utf8");
    assert.equal(pageSource, originalPageSource);
    const placementSource = await readFile(placementPath, "utf8");
    assert.equal(placementSource, originalPlacementSource);
  });
});
