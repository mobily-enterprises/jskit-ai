import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
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
    path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
    `const mainClientComponents = [];

function registerMainClientComponent(componentToken, resolveComponent) {
  const token = String(componentToken || "").trim();
  if (!token || typeof resolveComponent !== "function") {
    return;
  }
  mainClientComponents.push(
    Object.freeze({
      token,
      resolveComponent
    })
  );
}

class MainClientProvider {}

export { MainClientProvider, registerMainClientComponent };
`,
    "utf8"
  );
}

async function writePageFile(appRoot, targetFile, source = "<template><section /></template>\n") {
  const targetPath = path.join(appRoot, targetFile);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source, "utf8");
  return targetPath;
}

async function readPageFile(appRoot, targetFile) {
  return readFile(path.join(appRoot, targetFile), "utf8");
}

test("ui-generator add-subpages derives the default target from an index-route page path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/index.vue";
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
      "src/components/SectionContainerShell.vue",
      "src/components/TabLinkItem.vue",
      targetFile
    ]);

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(pageSource, /<ShellOutlet host="practice" position="sub-pages" \/>/);
    assert.match(pageSource, /<RouterView \/>/);
  });
});

test("ui-generator add-subpages derives the default target from a dynamic file-route page path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/contacts/[contactId].vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(pageSource, /<ShellOutlet host="contacts-contact-id" position="sub-pages" \/>/);
  });
});

test("ui-generator add-subpages derives the default target from a nested route path", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/catalog/products/index.vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {}
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(pageSource, /<ShellOutlet host="catalog-products" position="sub-pages" \/>/);
  });
});

test("ui-generator add-subpages supports explicit target host shorthand", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/index.vue";
    await writePageFile(appRoot, targetFile);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-subpages",
      args: [targetFile],
      options: {
        target: "practice-hub"
      }
    });

    const pageSource = await readPageFile(appRoot, targetFile);
    assert.match(pageSource, /<ShellOutlet host="practice-hub" position="sub-pages" \/>/);
  });
});

test("ui-generator add-subpages supports explicit target host:position", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/index.vue";
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
    assert.match(pageSource, /<ShellOutlet host="practice-hub" position="secondary-tabs" \/>/);
  });
});

test("ui-generator add-subpages fails if subpages are already enabled", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/index.vue";
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
        args: ["src/components/Panel.vue"],
        options: {}
      }),
      /target file must live under src\/pages\//
    );
  });
});

test("ui-generator add-subpages validates target format", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/index.vue";
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
      /option "target" must be "host" or "host:position"/
    );
  });
});
