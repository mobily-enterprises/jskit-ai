import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { readLocalLinkItemComponentSource } from "@jskit-ai/shell-web/server/support/localLinkItemScaffolds";
import { runGeneratorSubcommand } from "../src/server/subcommands/addSubpages.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-add-subpages-"));
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
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true }
  }
};
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
  await writeFile(
    path.join(appRoot, "src", "placementTopology.js"),
    `const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

export { addPlacementTopology };

export default function getPlacementTopology() {
  return { placements };
}
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
    `const mainClientComponents = [];

function registerMainClientComponent(token, resolveComponent) {
  mainClientComponents.push({ token, resolveComponent });
}

class MainClientProvider {}

export { MainClientProvider, registerMainClientComponent };
`,
    "utf8"
  );
}

async function writePageFile(appRoot, targetFile, source = "<template><section /></template>\n") {
  const targetPath = path.join(appRoot, "src/pages", targetFile);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source, "utf8");
  return targetPath;
}

async function readPageFile(appRoot, targetFile) {
  return readFile(path.join(appRoot, "src/pages", targetFile), "utf8");
}

test("ui-generator add-subpages derives the default target from an index-route page path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(
      appRoot,
      targetFile,
      `<template>
  <section class="pa-4">
    <h1 class="text-h5 mb-2">Practice</h1>
  </section>
</template>
`
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {
        title: "Practice",
        subtitle: "Manage practice modules."
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/menus/SurfaceAwareMenuLinkItem.vue",
      "src/components/SectionContainerShell.vue",
      `src/pages/${targetFile}`,
      "src/placementTopology.js"
    ]);

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(
      pageSource,
      /<ShellOutlet target="practice:sub-pages" \/>/
    );
    const topologySource = await readFile(path.join(appRoot, "src", "placementTopology.js"), "utf8");
    assert.match(topologySource, /id: "page\.section-nav"/);
    assert.match(topologySource, /owner: "practice"/);
    assert.match(topologySource, /compact: \{/);
    assert.match(topologySource, /medium: \{/);
    assert.match(topologySource, /expanded: \{/);
    assert.match(pageSource, /<RouterView \/>/);
    assert.equal(
      await readFile(path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue"), "utf8"),
      await readLocalLinkItemComponentSource("local.main.ui.surface-aware-menu-link-item")
    );
  });
});

test("ui-generator add-subpages derives the default target from a dynamic file-route page path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/contacts/[contactId].vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(
      pageSource,
      /<ShellOutlet target="contacts-contact-id:sub-pages" \/>/
    );
  });
});

test("ui-generator add-subpages derives the default target from a nested route path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/catalog/products/index.vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(
      pageSource,
      /<ShellOutlet target="catalog-products:sub-pages" \/>/
    );
  });
});

test("ui-generator add-subpages rejects explicit target shorthand without a position", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "add-subpages",
        args: [targetFile],
        options: {
          target: "practice-hub"
        }
      }),
      /option "target" must be a target in "host:position" format/
    );
  });
});

test("ui-generator add-subpages supports explicit target host:position", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {
        target: "practice-hub:secondary-tabs"
      }
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(
      pageSource,
      /<ShellOutlet target="practice-hub:secondary-tabs" \/>/
    );
  });
});

test("ui-generator add-subpages does not rewrite existing scaffold support components", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);
    const customSectionShellSource = `<template><section class="custom-shell"><slot /></section></template>\n`;
    const customSurfaceAwareLinkSource = `<template><button class="custom-surface-aware-link"><slot /></button></template>\n`;
    await writeFile(
      path.join(appRoot, "src", "components", "SectionContainerShell.vue"),
      customSectionShellSource,
      "utf8"
    );
    await mkdir(path.join(appRoot, "src", "components", "menus"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue"),
      customSurfaceAwareLinkSource,
      "utf8"
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {
        title: "Practice"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      `src/pages/${targetFile}`,
      "src/placementTopology.js"
    ]);
    assert.equal(
      await readFile(path.join(appRoot, "src", "components", "SectionContainerShell.vue"), "utf8"),
      customSectionShellSource
    );
    assert.equal(
      await readFile(path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue"), "utf8"),
      customSurfaceAwareLinkSource
    );
  });
});

test("ui-generator add-subpages fails if subpages are already enabled", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "add-subpages",
        args: [targetFile],
        options: {}
      }),
      /found existing RouterView.*Subpages are already enabled/
    );
  });
});

test("ui-generator add-subpages rejects files outside src/pages", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);
    await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
    await writeFile(path.join(appRoot, "src", "components", "Panel.vue"), "<template><div /></template>\n", "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "add-subpages",
        args: ["components/Panel.vue"],
        options: {}
      }),
      /must be relative to src\/pages\/ and resolve to a configured surface/
    );
  });
});

test("ui-generator add-subpages validates target format", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "add-subpages",
        args: [targetFile],
        options: {
          target: "practice:"
        }
      }),
      /option "target" must be a target in "host:position" format/
    );
  });
});

test("ui-generator add-subpages accepts target files with a src/pages prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const bareTargetFile = "w/[workspaceSlug]/admin/practice/index.vue";
    const targetFile = `src/pages/${bareTargetFile}`;
    await writePageFile(appRoot, bareTargetFile);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    assert.ok(result.touchedFiles.includes(targetFile));
    const pageSource = await readFile(path.join(appRoot, targetFile), "utf8");
    assert.match(
      pageSource,
      /<ShellOutlet target="practice:sub-pages" \/>/
    );
    assert.match(pageSource, /<RouterView \/>/);
  });
});
