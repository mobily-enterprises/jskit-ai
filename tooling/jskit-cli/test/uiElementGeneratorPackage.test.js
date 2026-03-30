import assert from "node:assert/strict";
import { access, constants as fsConstants, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UI_GENERATOR_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "ui-generator");
const KERNEL_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "pages", "admin", "workspace", "settings"), { recursive: true });
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `const config = {
  tenancyMode: "workspaces",
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: true
    }
  }
};

export default config;
export { config };
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
    path.join(appRoot, "src", "components", "ShellLayout.vue"),
    `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-left" />
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="shell-layout" position="secondary-menu" />
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

class MainClientProvider {
  static id = "local.main.client";
}

export {
  MainClientProvider,
  registerMainClientComponent
};
`,
    "utf8"
  );
}

async function installUiGeneratorPackage(appRoot) {
  const scopedRoot = path.join(appRoot, "node_modules", "@jskit-ai");
  const packageRoot = path.join(scopedRoot, "ui-generator");
  const kernelRoot = path.join(scopedRoot, "kernel");
  await mkdir(path.dirname(packageRoot), { recursive: true });
  await cp(UI_GENERATOR_SOURCE_ROOT, packageRoot, { recursive: true });
  await cp(KERNEL_SOURCE_ROOT, kernelRoot, { recursive: true });
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("generate @jskit-ai/ui-generator page scaffolds page and menu placement", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-default");
    await createMinimalApp(appRoot, { name: "ui-element-generator-default" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "--name",
        "Reports Dashboard",
        "--surface",
        "admin"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pagePath = path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue");
    const placementPath = path.join(appRoot, "src", "placement.js");

    assert.equal(await fileExists(pagePath), true);

    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /Reports Dashboard/);

    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /id: "ui-generator\.page\.reports-dashboard\.menu"/);
    assert.match(placementSource, /position: "primary-menu"/);
    assert.match(placementSource, /workspaceSuffix: "\/reports-dashboard"/);
    assert.match(placementSource, /label: "Reports Dashboard"/);
  });
});

test("generate @jskit-ai/ui-generator element scaffolds component token registration and outlet placement", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-override");
    await createMinimalApp(appRoot, { name: "ui-element-generator-override" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "element",
        "--name",
        "Ops Panel",
        "--surface",
        "admin",
        "--path",
        "src/widgets",
        "--placement",
        "workspace-settings:forms"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const componentPath = path.join(appRoot, "src", "widgets", "OpsPanelElement.vue");
    const pagePath = path.join(appRoot, "src", "pages", "admin", "ops-panel", "index.vue");
    const placementPath = path.join(appRoot, "src", "placement.js");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");

    assert.equal(await fileExists(componentPath), true);
    assert.equal(await fileExists(pagePath), false);

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /import OpsPanelElement from "\/src\/widgets\/OpsPanelElement\.vue";/);
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.element\.ops-panel", \(\) => OpsPanelElement\);/);

    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /id: "ui-generator\.element\.ops-panel"/);
    assert.match(placementSource, /host: "workspace-settings"/);
    assert.match(placementSource, /position: "forms"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.element\.ops-panel"/);
  });
});
