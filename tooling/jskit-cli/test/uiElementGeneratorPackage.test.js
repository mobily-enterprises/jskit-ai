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
    <ShellOutlet host="admin-settings" position="forms" />
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
        "src/pages/admin/reports-dashboard/index.vue",
        "--name",
        "Reports Dashboard"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pagePath = path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue");
    const placementPath = path.join(appRoot, "src", "placement.js");

    assert.equal(await fileExists(pagePath), true);

    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /Reports Dashboard/);

    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /id: "ui-generator\.page\.reports-dashboard\.link"/);
    assert.match(placementSource, /position: "primary-menu"/);
    assert.match(placementSource, /componentToken: "users\.web\.shell\.surface-aware-menu-link-item"/);
    assert.match(placementSource, /workspaceSuffix: "\/reports-dashboard"/);
    assert.match(placementSource, /label: "Reports Dashboard"/);
  });
});

test("generate @jskit-ai/ui-generator page creates an explicit file-route target", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-file-page");
    await createMinimalApp(appRoot, { name: "ui-element-generator-file-page" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/contacts/[contactId].vue",
        "--name",
        "Contact"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pagePath = path.join(appRoot, "src", "pages", "admin", "contacts", "[contactId].vue");
    const placementPath = path.join(appRoot, "src", "placement.js");

    assert.equal(await fileExists(pagePath), true);

    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /Contact/);

    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /workspaceSuffix: "\/contacts\/\[contactId\]"/);
    assert.match(placementSource, /id: "ui-generator\.page\.contacts\.contact-id\.link"/);
  });
});

test("generate @jskit-ai/ui-generator page supports link-component-token and auto nestedChildren link-to", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-nested-children");
    await createMinimalApp(appRoot, { name: "ui-element-generator-nested-children" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/contacts/[contactId]/(nestedChildren)/notes/index.vue",
        "--name",
        "Notes",
        "--link-placement",
        "shell-layout:secondary-menu",
        "--link-component-token",
        "local.main.ui.tab-link-item"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pagePath = path.join(
      appRoot,
      "src",
      "pages",
      "admin",
      "contacts",
      "[contactId]",
      "(nestedChildren)",
      "notes",
      "index.vue"
    );
    const placementPath = path.join(appRoot, "src", "placement.js");
    assert.equal(await fileExists(pagePath), true);

    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /workspaceSuffix: "\/contacts\/\[contactId\]\/notes"/);
    assert.match(placementSource, /nonWorkspaceSuffix: "\/contacts\/\[contactId\]\/notes"/);
    assert.match(placementSource, /to: "\.\/notes"/);
  });
});

test("generate @jskit-ai/ui-generator page supports explicit link-to override", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-link-to");
    await createMinimalApp(appRoot, { name: "ui-element-generator-link-to" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/contacts/[contactId]/(nestedChildren)/notes/index.vue",
        "--name",
        "Notes",
        "--link-placement",
        "shell-layout:secondary-menu",
        "--link-component-token",
        "local.main.ui.tab-link-item",
        "--link-to",
        "./custom-notes"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /to: "\.\/custom-notes"/);
  });
});

test("generate @jskit-ai/ui-generator page infers subpage link placement from the nearest parent host", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-inferred-subpage-link");
    await createMinimalApp(appRoot, { name: "ui-element-generator-inferred-subpage-link" });
    await installUiGeneratorPackage(appRoot);

    const parentPagePath = path.join(appRoot, "src", "pages", "admin", "contacts", "[contactId].vue");
    await mkdir(path.dirname(parentPagePath), { recursive: true });
    await writeFile(
      parentPagePath,
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet host="contact-view" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/contacts/[contactId]/notes/index.vue",
        "--name",
        "Notes"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /host: "contact-view"/);
    assert.match(placementSource, /position: "sub-pages"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/notes"/);
  });
});

test("generate @jskit-ai/ui-generator page uses path-aware placement IDs for same-named nested pages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-placement-id-collision");
    await createMinimalApp(appRoot, { name: "ui-element-generator-placement-id-collision" });
    await installUiGeneratorPackage(appRoot);

    const alphaResult = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/alpha/(nestedChildren)/one/index.vue",
        "--name",
        "One",
        "--link-placement",
        "shell-layout:secondary-menu",
        "--link-component-token",
        "local.main.ui.tab-link-item"
      ]
    });
    assert.equal(alphaResult.status, 0, String(alphaResult.stderr || ""));

    const betaResult = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/beta/(nestedChildren)/one/index.vue",
        "--name",
        "One",
        "--link-placement",
        "shell-layout:secondary-menu",
        "--link-component-token",
        "local.main.ui.tab-link-item"
      ]
    });
    assert.equal(betaResult.status, 0, String(betaResult.stderr || ""));

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementSource = await readFile(placementPath, "utf8");
    const placementIds = Array.from(
      placementSource.matchAll(/id: "([^"]+)"/g),
      (match) => match[1]
    );

    assert.match(placementSource, /id: "ui-generator\.page\.alpha\.one\.link"/);
    assert.match(placementSource, /id: "ui-generator\.page\.beta\.one\.link"/);
    assert.equal(placementIds.includes("ui-generator.page.one.link"), false);
    assert.equal(new Set(placementIds).size, placementIds.length);
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
        "shell-layout:top-right"
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
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "top-right"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.element\.ops-panel"/);
  });
});

test("generate @jskit-ai/ui-generator add-subpages derives the default target for an existing file-route page", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-add-subpages-generator-dynamic-route");
    await createMinimalApp(appRoot, { name: "ui-add-subpages-generator-dynamic-route" });
    await installUiGeneratorPackage(appRoot);

    const pageResult = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "src/pages/admin/contacts/[contactId].vue",
        "--name",
        "Contact"
      ]
    });
    assert.equal(pageResult.status, 0, String(pageResult.stderr || ""));

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "add-subpages",
        "src/pages/admin/contacts/[contactId].vue",
        "--title",
        "Contact",
        "--subtitle",
        "Manage contact modules."
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pagePath = path.join(appRoot, "src", "pages", "admin", "contacts", "[contactId].vue");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
    const sectionShellPath = path.join(appRoot, "src", "components", "SectionContainerShell.vue");
    const tabLinkPath = path.join(appRoot, "src", "components", "TabLinkItem.vue");

    assert.equal(await fileExists(pagePath), true);
    assert.equal(await fileExists(sectionShellPath), true);
    assert.equal(await fileExists(tabLinkPath), true);

    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /<SectionContainerShell/);
    assert.match(pageSource, /<template #tabs>/);
    assert.match(pageSource, /<ShellOutlet host="contacts-contact-id" position="sub-pages" \/>/);
    assert.match(pageSource, /<RouterView \/>/);

    const sectionShellSource = await readFile(sectionShellPath, "utf8");
    assert.match(sectionShellSource, /<slot name="tabs" \/>/);
    assert.doesNotMatch(sectionShellSource, /ShellOutlet/);

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);
  });
});
