import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";
import { writeInstalledPackagesLock } from "./testLock.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ASSISTANT_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "assistant");
const KERNEL_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "assistant-cli-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
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
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: true,
      accessPolicyId: "workspace_member"
    },
    console: {
      id: "console",
      pagesRoot: "console",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: false,
      accessPolicyId: "console_owner"
    }
  },
  assistantSurfaces: {}
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
    <ShellOutlet target="shell-layout:top-right" />
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
  </div>
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

class MainClientProvider {}

export { MainClientProvider, registerMainClientComponent };
export default MainClientProvider;
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

async function installAssistantGenerator(appRoot) {
  const scopedRoot = path.join(appRoot, "node_modules", "@jskit-ai");
  await mkdir(scopedRoot, { recursive: true });
  await cp(ASSISTANT_SOURCE_ROOT, path.join(scopedRoot, "assistant"), { recursive: true });
  await cp(KERNEL_SOURCE_ROOT, path.join(scopedRoot, "kernel"), { recursive: true });
}

test("generate @jskit-ai/assistant page scaffolds an assistant runtime page at an explicit target file", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "assistant-cli-page");
    await createMinimalApp(appRoot, { name: "assistant-cli-page" });
    await installAssistantGenerator(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/assistant", "page", "admin/copilot/index.vue"]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pageSource = await readFile(path.join(appRoot, "src/pages/admin/copilot/index.vue"), "utf8");
    assert.match(pageSource, /<AssistantSurfaceClientElement surface-id="admin" \/>/);

    const placementSource = await readFile(path.join(appRoot, "src/placement.js"), "utf8");
    assert.match(placementSource, /jskit:assistant\.page\.link:admin:\/copilot/);
    assert.match(placementSource, /label: "Copilot"/);
    assert.match(placementSource, /scopedSuffix: "\/copilot"/);
  });
});

test("generate @jskit-ai/assistant page refuses to overwrite an existing page without --force", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "assistant-cli-page-existing");
    await createMinimalApp(appRoot, { name: "assistant-cli-page-existing" });
    await installAssistantGenerator(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/copilot"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/copilot/index.vue"),
      `<template>
  <div>custom assistant page</div>
</template>
`,
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/assistant", "page", "admin/copilot/index.vue"]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /assistant page will not overwrite existing page src\/pages\/admin\/copilot\/index\.vue\. Re-run with --force to overwrite it\./
    );

    const pageSource = await readFile(path.join(appRoot, "src/pages/admin/copilot/index.vue"), "utf8");
    assert.match(pageSource, /custom assistant page/);
  });
});

test("generate @jskit-ai/assistant page overwrites an existing page when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "assistant-cli-page-force");
    await createMinimalApp(appRoot, { name: "assistant-cli-page-force" });
    await installAssistantGenerator(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/copilot"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/copilot/index.vue"),
      `<template>
  <div>custom assistant page</div>
</template>
`,
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/assistant", "page", "admin/copilot/index.vue", "--force"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Regenerated assistant page "\/copilot"\./);

    const pageSource = await readFile(path.join(appRoot, "src/pages/admin/copilot/index.vue"), "utf8");
    assert.match(pageSource, /<AssistantSurfaceClientElement surface-id="admin" \/>/);
    assert.doesNotMatch(pageSource, /custom assistant page/);
  });
});

test("generate @jskit-ai/assistant settings-page scaffolds a settings page at an explicit target file", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "assistant-cli-settings-page");
    await createMinimalApp(appRoot, { name: "assistant-cli-settings-page" });
    await installAssistantGenerator(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/settings"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/settings/index.vue"),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="admin-settings:sub-pages" />
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
        "@jskit-ai/assistant",
        "settings-page",
        "admin/settings/index/assistant/index.vue",
        "--surface",
        "console"
      ]
    });
    assert.equal(result.status, 0, String(result.stderr || ""));

    const pageSource = await readFile(
      path.join(appRoot, "src/pages/admin/settings/index/assistant/index.vue"),
      "utf8"
    );
    assert.match(pageSource, /<AssistantSettingsClientElement target-surface-id="console" \/>/);

    const placementSource = await readFile(path.join(appRoot, "src/placement.js"), "utf8");
    assert.match(placementSource, /jskit:assistant\.settings-page\.link:admin:\/settings\/assistant:console/);
    assert.match(placementSource, /target: "admin-settings:sub-pages"/);
    assert.match(placementSource, /to: "\.\/assistant"/);
  });
});

test("generate @jskit-ai/assistant settings-page overwrites an existing page when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "assistant-cli-settings-page-force");
    await createMinimalApp(appRoot, { name: "assistant-cli-settings-page-force" });
    await installAssistantGenerator(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/settings"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/settings/index.vue"),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="admin-settings:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );
    await mkdir(path.join(appRoot, "src/pages/admin/settings/index/assistant"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/settings/index/assistant/index.vue"),
      `<template>
  <div>custom settings page</div>
</template>
`,
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/assistant",
        "settings-page",
        "admin/settings/index/assistant/index.vue",
        "--surface",
        "console",
        "--force"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Regenerated assistant page "\/settings\/assistant"\./);

    const pageSource = await readFile(
      path.join(appRoot, "src/pages/admin/settings/index/assistant/index.vue"),
      "utf8"
    );
    assert.match(pageSource, /<AssistantSettingsClientElement target-surface-id="console" \/>/);
    assert.doesNotMatch(pageSource, /custom settings page/);
  });
});
