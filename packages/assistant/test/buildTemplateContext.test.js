import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildTemplateContext } from "../src/server/buildTemplateContext.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "assistant-generator-"));
  try {
    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify({ name: "assistant-generator-test-app", private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", enabled: true, requiresWorkspace: false, accessPolicyId: "authenticated" },
    admin: { id: "admin", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
    console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
  }
};
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "components", "ShellLayout.vue"),
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" />
    <ShellOutlet host="shell-layout" position="top-right" default />
  </div>
</template>
`,
      "utf8"
    );

    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("buildTemplateContext derives runtime, settings, and table placeholders from explicit surfaces", async () => {
  await withTempApp(async (appRoot) => {
    const context = await buildTemplateContext({
      appRoot,
      options: {
        "runtime-surface": "app",
        "settings-surface": "console",
        "config-scope": "global",
        placement: "shell-layout:primary-menu",
        "menu-label": "Copilot"
      }
    });

    assert.equal(context.__ASSISTANT_RUNTIME_SURFACE_ID__, "app");
    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_ID__, "console");
    assert.equal(context.__ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__, "false");
    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_REQUIRES_WORKSPACE__, "false");
    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_REQUIRES_CONSOLE_OWNER__, "true");
    assert.equal(context.__ASSISTANT_CONFIG_SCOPE__, "global");
    assert.equal(context.__ASSISTANT_SETTINGS_HOST__, "console-settings");
    assert.equal(context.__ASSISTANT_CONVERSATIONS_TABLE__, "assistant_app_conversations");
    assert.equal(context.__ASSISTANT_MESSAGES_TABLE__, "assistant_app_messages");
    assert.equal(context.__ASSISTANT_MENU_PLACEMENT_HOST__, "shell-layout");
    assert.equal(context.__ASSISTANT_MENU_PLACEMENT_POSITION__, "primary-menu");
    assert.equal(context.__ASSISTANT_MENU_LABEL__, "Copilot");
  });
});

test("buildTemplateContext rejects workspace config scope for non-workspace surfaces", async () => {
  await withTempApp(async (appRoot) => {
    await assert.rejects(
      () =>
        buildTemplateContext({
          appRoot,
          options: {
            "runtime-surface": "app",
            "settings-surface": "console",
            "config-scope": "workspace",
            placement: "shell-layout:primary-menu"
          }
        }),
      /config-scope "workspace" requires runtime surface "app" with requiresWorkspace=true/
    );
  });
});

test("buildTemplateContext accepts workspace config scope when both surfaces require workspace", async () => {
  await withTempApp(async (appRoot) => {
    const context = await buildTemplateContext({
      appRoot,
      options: {
        "runtime-surface": "admin",
        "settings-surface": "admin",
        "config-scope": "workspace",
        placement: "shell-layout:top-right"
      }
    });

    assert.equal(context.__ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__, "true");
    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_REQUIRES_WORKSPACE__, "true");
    assert.equal(context.__ASSISTANT_SETTINGS_HOST__, "admin-settings");
    assert.equal(context.__ASSISTANT_CONVERSATIONS_TABLE__, "assistant_admin_conversations");
    assert.equal(context.__ASSISTANT_MESSAGES_TABLE__, "assistant_admin_messages");
  });
});
