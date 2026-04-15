import assert from "node:assert/strict";
import { access, constants as fsConstants, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readLocalLinkItemComponentSource } from "@jskit-ai/shell-web/server/support/localLinkItemScaffolds";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";
import { writeInstalledPackagesLock } from "./testLock.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UI_GENERATOR_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "ui-generator");
const KERNEL_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const SHELL_WEB_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "shell-web");
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
    <ShellOutlet target="shell-layout:top-left" />
    <ShellOutlet target="shell-layout:top-right" />
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
    <ShellOutlet
      target="shell-layout:secondary-menu"
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
  </div>
</template>
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "src", "pages", "admin", "workspace", "settings", "index.vue"),
    `<template>
  <section>
    <ShellOutlet target="admin-settings:forms" />
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

  await writeInstalledPackagesLock(appRoot, {
    "@jskit-ai/shell-web": {
      packageId: "@jskit-ai/shell-web",
      version: "0.1.0"
    }
  });
}

async function installUiGeneratorPackage(appRoot) {
  const scopedRoot = path.join(appRoot, "node_modules", "@jskit-ai");
  const packageRoot = path.join(scopedRoot, "ui-generator");
  const kernelRoot = path.join(scopedRoot, "kernel");
  const shellWebRoot = path.join(scopedRoot, "shell-web");
  await mkdir(path.dirname(packageRoot), { recursive: true });
  await cp(UI_GENERATOR_SOURCE_ROOT, packageRoot, { recursive: true });
  await cp(KERNEL_SOURCE_ROOT, kernelRoot, { recursive: true });
  await cp(SHELL_WEB_SOURCE_ROOT, shellWebRoot, { recursive: true });
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
        "admin/reports-dashboard/index.vue",
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
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.reports-dashboard\.link"/);
    assert.match(placementSource, /target: "shell-layout:primary-menu"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.surface-aware-menu-link-item"/);
    assert.match(placementSource, /workspaceSuffix: "\/reports-dashboard"/);
    assert.match(placementSource, /label: "Reports Dashboard"/);

    const localLinkComponentPath = path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
    assert.equal(await fileExists(localLinkComponentPath), true);

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /import SurfaceAwareMenuLinkItem from "\/src\/components\/menus\/SurfaceAwareMenuLinkItem\.vue";/);
    assert.match(
      providerSource,
      /registerMainClientComponent\("local\.main\.ui\.surface-aware-menu-link-item", \(\) => SurfaceAwareMenuLinkItem\);/
    );
  });
});

test("generate @jskit-ai/ui-generator page requires shell-web to be installed in lock", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-shell-gate");
    await createMinimalApp(appRoot, { name: "ui-element-generator-shell-gate" });
    await writeInstalledPackagesLock(appRoot, {});
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "admin/reports-dashboard/index.vue",
        "--name",
        "Reports Dashboard"
      ]
    });

    assert.equal(result.status, 1);
    assert.match(String(result.stderr || ""), /requires @jskit-ai\/shell-web to be installed in this app/i);
    assert.equal(await fileExists(path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue")), false);
  });
});

test("generate @jskit-ai/ui-generator with no subcommand shows generator help without mutating app deps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-primary-help");
    await createMinimalApp(appRoot, { name: "ui-element-generator-primary-help" });
    await installUiGeneratorPackage(appRoot);

    const packageJsonPath = path.join(appRoot, "package.json");
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(
        {
          name: "ui-element-generator-primary-help",
          version: "0.1.0",
          private: true,
          type: "module",
          dependencies: {
            "@jskit-ai/users-web": "0.1.46"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const packageJsonBefore = await readFile(packageJsonPath, "utf8");
    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    const lockBefore = await readFile(lockPath, "utf8");

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/ui-generator"]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator help: @jskit-ai\/ui-generator/);

    const packageJsonAfter = await readFile(packageJsonPath, "utf8");
    assert.equal(packageJsonAfter, packageJsonBefore);
    assert.equal(await readFile(lockPath, "utf8"), lockBefore);
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
        "admin/contacts/[contactId].vue",
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
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.contacts\.contact-id\.link"/);
  });
});

test("generate @jskit-ai/ui-generator page refuses to overwrite an existing page without --force", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-page-existing");
    await createMinimalApp(appRoot, { name: "ui-element-generator-page-existing" });
    await installUiGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "src", "pages", "admin", "reports-dashboard"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue"),
      `<template>
  <div>custom reports page</div>
</template>
`,
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/ui-generator", "page", "admin/reports-dashboard/index.vue"]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /ui-generator page will not overwrite existing page src\/pages\/admin\/reports-dashboard\/index\.vue\. Re-run with --force to overwrite it\./
    );

    const pageSource = await readFile(
      path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue"),
      "utf8"
    );
    assert.match(pageSource, /custom reports page/);
  });
});

test("generate @jskit-ai/ui-generator page overwrites an existing page when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-page-force");
    await createMinimalApp(appRoot, { name: "ui-element-generator-page-force" });
    await installUiGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "src", "pages", "admin", "reports-dashboard"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue"),
      `<template>
  <div>custom reports page</div>
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
        "admin/reports-dashboard/index.vue",
        "--name",
        "Reports Dashboard",
        "--force"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Regenerated UI page "\/reports-dashboard"/);

    const pageSource = await readFile(
      path.join(appRoot, "src", "pages", "admin", "reports-dashboard", "index.vue"),
      "utf8"
    );
    assert.match(pageSource, /Reports Dashboard/);
    assert.doesNotMatch(pageSource, /custom reports page/);
  });
});

test("generate @jskit-ai/ui-generator page supports link-component-token for index-hosted child pages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-index-children");
    await createMinimalApp(appRoot, { name: "ui-element-generator-index-children" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "page",
        "admin/contacts/[contactId]/index/notes/index.vue",
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
      "index",
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
        "admin/contacts/[contactId]/index/notes/index.vue",
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
      <ShellOutlet target="contact-view:sub-pages" />
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
        "admin/contacts/[contactId]/notes/index.vue",
        "--name",
        "Notes"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /target: "contact-view:sub-pages"/);
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
        "admin/alpha/index/one/index.vue",
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
        "admin/beta/index/one/index.vue",
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

    assert.match(placementSource, /id: "ui-generator\.page\.admin\.alpha\.one\.link"/);
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.beta\.one\.link"/);
    assert.equal(placementIds.includes("ui-generator.page.one.link"), false);
    assert.equal(new Set(placementIds).size, placementIds.length);
  });
});

test("generate @jskit-ai/ui-generator placed-element scaffolds component token registration and outlet placement", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-override");
    await createMinimalApp(appRoot, { name: "ui-element-generator-override" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "placed-element",
        "--name",
        "Ops Panel",
        "--path",
        "src/widgets"
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
    assert.match(placementSource, /target: "shell-layout:top-right"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.element\.ops-panel"/);
  });
});

test("generate @jskit-ai/ui-generator placed-element supports explicit placement override", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-explicit-placement");
    await createMinimalApp(appRoot, { name: "ui-element-generator-explicit-placement" });
    await installUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "placed-element",
        "--name",
        "Ops Panel",
        "--placement",
        "shell-layout:primary-menu"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementSource = await readFile(placementPath, "utf8");
    assert.match(placementSource, /target: "shell-layout:primary-menu"/);
  });
});

test("generate @jskit-ai/ui-generator placed-element refuses to overwrite an existing component without force", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-existing-component");
    await createMinimalApp(appRoot, { name: "ui-element-generator-existing-component" });
    await installUiGeneratorPackage(appRoot);
    const componentPath = path.join(appRoot, "src", "components", "OpsPanelElement.vue");
    const placementPath = path.join(appRoot, "src", "placement.js");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
    const placementBefore = await readFile(placementPath, "utf8");
    const providerBefore = await readFile(providerPath, "utf8");

    await writeFile(componentPath, "<template><div>custom</div></template>\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "placed-element",
        "--name",
        "Ops Panel",
        "--surface",
        "admin"
      ]
    });
    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /ui-generator placed-element will not overwrite existing component file src\/components\/OpsPanelElement\.vue\. Re-run with --force to overwrite it\./
    );

    assert.equal(await readFile(componentPath, "utf8"), "<template><div>custom</div></template>\n");
    assert.equal(await readFile(placementPath, "utf8"), placementBefore);
    assert.equal(await readFile(providerPath, "utf8"), providerBefore);
  });
});

test("generate @jskit-ai/ui-generator placed-element overwrites an existing component when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-force-overwrite");
    await createMinimalApp(appRoot, { name: "ui-element-generator-force-overwrite" });
    await installUiGeneratorPackage(appRoot);
    const componentPath = path.join(appRoot, "src", "components", "OpsPanelElement.vue");

    await writeFile(componentPath, "<template><div>custom</div></template>\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/ui-generator",
        "placed-element",
        "--name",
        "Ops Panel",
        "--surface",
        "admin",
        "--force"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const componentSource = await readFile(componentPath, "utf8");
    assert.match(componentSource, /<h2 class="text-h6 mb-2">Ops Panel<\/h2>/);
  });
});

test("generate @jskit-ai/ui-generator placed-element prints subcommand help for unsupported options", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-element-generator-unknown-option-help");
    await createMinimalApp(appRoot, { name: "ui-element-generator-unknown-option-help" });
    await installUiGeneratorPackage(appRoot);

    const placementPath = path.join(appRoot, "src", "placement.js");
    const placementBefore = await readFile(placementPath, "utf8");

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "ui-generator",
        "placed-element",
        "--name",
        "Ops Panel",
        "--surface",
        "admin",
        "--i_do_not_exist"
      ]
    });
    assert.equal(result.status, 1);

    const stderr = String(result.stderr || "");
    assert.match(stderr, /jskit: Unknown option for generator command ui-generator placed-element: --i_do_not_exist\./);
    assert.match(stderr, /Generator subcommand help: @jskit-ai\/ui-generator placed-element/);
    assert.match(stderr, /--surface/);
    assert.doesNotMatch(stderr, /JSKit CLI/);

    const componentPath = path.join(appRoot, "src", "components", "OpsPanelElement.vue");
    assert.equal(await fileExists(componentPath), false);
    assert.equal(await readFile(placementPath, "utf8"), placementBefore);
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
        "admin/contacts/[contactId].vue",
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
        "admin/contacts/[contactId].vue",
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
    const tabLinkPath = path.join(appRoot, "src", "components", "menus", "TabLinkItem.vue");

    assert.equal(await fileExists(pagePath), true);
    assert.equal(await fileExists(sectionShellPath), true);
    assert.equal(await fileExists(tabLinkPath), true);

    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /<SectionContainerShell/);
    assert.match(pageSource, /<template #tabs>/);
    assert.match(
      pageSource,
      /<ShellOutlet target="contacts-contact-id:sub-pages" default-link-component-token="local\.main\.ui\.tab-link-item" \/>/
    );
    assert.match(pageSource, /<RouterView \/>/);

    const sectionShellSource = await readFile(sectionShellPath, "utf8");
    assert.match(sectionShellSource, /<slot name="tabs" \/>/);
    assert.doesNotMatch(sectionShellSource, /ShellOutlet/);
    assert.equal(
      await readFile(tabLinkPath, "utf8"),
      await readLocalLinkItemComponentSource("local.main.ui.tab-link-item")
    );

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);
  });
});
