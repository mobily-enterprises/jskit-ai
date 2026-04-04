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
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

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
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/SectionContainerShell.vue",
      "src/components/TabLinkItem.vue",
      "src/pages/w/[workspaceSlug]/admin/practice.vue"
    ]);

    const containerSource = await readFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "practice.vue"),
      "utf8"
    );
    assert.match(containerSource, /<SectionContainerShell/);
    assert.match(containerSource, /host="practice"/);
    assert.match(containerSource, /<RouterView \/>/);
    assert.match(containerSource, /"surface": "admin"/);
    assert.match(containerSource, /"placements": \{/);
    assert.match(containerSource, /"outlets": \[/);
    assert.match(containerSource, /"host": "practice"/);
    assert.match(containerSource, /"position": "sub-pages"/);

    const sectionShellSource = await readFile(path.join(appRoot, "src", "components", "SectionContainerShell.vue"), "utf8");
    assert.match(sectionShellSource, /<ShellOutlet :host="props\.host" :position="props\.position" \/>/);

    const tabLinkSource = await readFile(path.join(appRoot, "src", "components", "TabLinkItem.vue"), "utf8");
    assert.match(tabLinkSource, /useWorkspaceRouteContext/);
    assert.match(tabLinkSource, /class="tab-link-item text-none"/);
    assert.equal(tabLinkSource.includes("source.replace(/\\[([^\\]]+)\\]/g"), true);
    assert.equal(tabLinkSource.includes("source.replace(/[([^]]+)]/g"), false);

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(
      providerSource,
      /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/
    );

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /id: "ui-generator\.container\.practice\.menu"/);
  });
});

test("ui-generator container preserves bracket route params in directory-prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "container",
      options: {
        name: "Contact Tools",
        surface: "admin",
        "directory-prefix": "contacts/[contactId]"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/SectionContainerShell.vue",
      "src/components/TabLinkItem.vue",
      "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/contact-tools.vue"
    ]);

    const containerSource = await readFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "contacts", "[contactId]", "contact-tools.vue"),
      "utf8"
    );
    assert.match(containerSource, /host="contact-tools"/);
    assert.match(containerSource, /"host": "contact-tools"/);
    assert.match(containerSource, /"position": "sub-pages"/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.container\.menu:admin:contacts\/\[contactId\]\/contact-tools/);
  });
});

test("ui-generator container appends menu placement only when --placement is provided", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "container",
      options: {
        name: "Practice",
        surface: "admin",
        placement: "shell-layout:top-right"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/SectionContainerShell.vue",
      "src/components/TabLinkItem.vue",
      "src/pages/w/[workspaceSlug]/admin/practice.vue",
      "src/placement.js"
    ]);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.container\.practice\.menu"/);
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "top-right"/);
    assert.match(placementSource, /workspaceSuffix: "\/practice"/);
  });
});

test("ui-generator container backfills route meta placements on existing container page", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await mkdir(path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "practice.vue"),
      `<script setup>
import { RouterView } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
</script>

<template>
  <SectionContainerShell
    title="Practice"
    subtitle="Manage practice modules."
    host="practice"
    position="sub-pages"
  >
    <RouterView />
  </SectionContainerShell>
</template>

<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "admin"
    }
  }
}
</route>
`,
      "utf8"
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "container",
      options: {
        name: "Practice",
        surface: "admin"
      }
    });

    assert.match(result.touchedFiles.join("\n"), /src\/pages\/w\/\[workspaceSlug\]\/admin\/practice\.vue/);

    const containerSource = await readFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "practice.vue"),
      "utf8"
    );
    assert.match(containerSource, /"placements": \{/);
    assert.match(containerSource, /"outlets": \[/);
    assert.match(containerSource, /"host": "practice"/);
    assert.match(containerSource, /"position": "sub-pages"/);
  });
});
