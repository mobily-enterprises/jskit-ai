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
      "src/components/SectionShellTabLinkItem.vue",
      "src/pages/w/[workspaceSlug]/admin/practice.vue",
      "src/placement.js"
    ]);

    const containerSource = await readFile(
      path.join(appRoot, "src", "pages", "w", "[workspaceSlug]", "admin", "practice.vue"),
      "utf8"
    );
    assert.match(containerSource, /<SectionContainerShell/);
    assert.match(containerSource, /host="practice"/);
    assert.match(containerSource, /<RouterView \/>/);
    assert.match(containerSource, /"surface": "admin"/);

    const sectionShellSource = await readFile(path.join(appRoot, "src", "components", "SectionContainerShell.vue"), "utf8");
    assert.match(sectionShellSource, /<ShellOutlet :host="props\.host" :position="props\.position" \/>/);

    const tabLinkSource = await readFile(path.join(appRoot, "src", "components", "SectionShellTabLinkItem.vue"), "utf8");
    assert.match(tabLinkSource, /useWorkspaceRouteContext/);
    assert.match(tabLinkSource, /class="section-shell-tab-link text-none"/);

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(
      providerSource,
      /registerMainClientComponent\("local\.main\.ui\.section-shell\.tab-link-item", \(\) => SectionShellTabLinkItem\);/
    );

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.container\.practice\.menu"/);
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "primary-menu"/);
    assert.match(placementSource, /workspaceSuffix: "\/practice"/);
  });
});
