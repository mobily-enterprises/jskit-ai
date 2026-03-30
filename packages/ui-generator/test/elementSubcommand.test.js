import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/element.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-element-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeAppFixture(appRoot) {
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "pages", "admin", "workspace", "settings"), { recursive: true });
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

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
    path.join(appRoot, "src", "pages", "admin", "workspace", "settings", "index.vue"),
    `<template>
  <section>
    <ShellOutlet host="workspace-settings" position="forms" />
  </section>
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

test("ui-generator element subcommand creates component and outlet placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "element",
      options: {
        name: "Ops Panel",
        surface: "admin",
        placement: "workspace-settings:forms"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/OpsPanelElement.vue",
      "src/placement.js"
    ]);

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(providerSource, /import OpsPanelElement from "\/src\/components\/OpsPanelElement\.vue";/);
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.element\.ops-panel", \(\) => OpsPanelElement\);/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.element\.ops-panel"/);
    assert.match(placementSource, /host: "workspace-settings"/);
    assert.match(placementSource, /position: "forms"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.element\.ops-panel"/);
  });
});

test("ui-generator element subcommand requires appRoot", async () => {
  await assert.rejects(
    () =>
      runGeneratorSubcommand({
        appRoot: "",
        subcommand: "element",
        options: {
          name: "Ops Panel",
          surface: "admin"
        }
      }),
    /requires appRoot/
  );
});
