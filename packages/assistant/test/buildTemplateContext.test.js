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
  },
  assistantSurfaces: {}
};
`,
      "utf8"
    );

    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("buildTemplateContext derives assistant setup placeholders from explicit setup surfaces", async () => {
  await withTempApp(async (appRoot) => {
    const context = await buildTemplateContext({
      appRoot,
      options: {
        surface: "app",
        "settings-surface": "console",
        "config-scope": "global"
      }
    });

    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_ID__, "console");
    assert.equal(context.__ASSISTANT_CONFIG_SCOPE__, "global");
    assert.equal(context.__ASSISTANT_AI_CONFIG_PREFIX__, "APP_ASSISTANT");
  });
});

test("buildTemplateContext honors explicit AI config prefix overrides", async () => {
  await withTempApp(async (appRoot) => {
    const context = await buildTemplateContext({
      appRoot,
      options: {
        surface: "app",
        "settings-surface": "console",
        "config-scope": "global",
        "ai-config-prefix": "CUSTOM_ASSISTANT"
      }
    });

    assert.equal(context.__ASSISTANT_AI_CONFIG_PREFIX__, "CUSTOM_ASSISTANT");
  });
});

test("buildTemplateContext rejects workspace config scope for a non-workspace assistant surface", async () => {
  await withTempApp(async (appRoot) => {
    await assert.rejects(
      () =>
        buildTemplateContext({
          appRoot,
          options: {
            surface: "app",
            "settings-surface": "console",
            "config-scope": "workspace"
          }
        }),
      /config-scope "workspace" requires surface "app" with requiresWorkspace=true/
    );
  });
});

test("buildTemplateContext accepts an already-configured matching assistant surface", async () => {
  await withTempApp(async (appRoot) => {
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", enabled: true, requiresWorkspace: false, accessPolicyId: "authenticated" },
    console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
  },
  assistantSurfaces: {
    app: {
      settingsSurfaceId: "console",
      configScope: "global"
    }
  }
};
`,
      "utf8"
    );

    const context = await buildTemplateContext({
      appRoot,
      options: {
        surface: "app",
        "settings-surface": "console",
        "config-scope": "global"
      }
    });

    assert.equal(context.__ASSISTANT_SETTINGS_SURFACE_ID__, "console");
    assert.equal(context.__ASSISTANT_CONFIG_SCOPE__, "global");
  });
});

test("buildTemplateContext rejects conflicting assistant surfaces already configured in public config", async () => {
  await withTempApp(async (appRoot) => {
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", enabled: true, requiresWorkspace: false, accessPolicyId: "authenticated" },
    admin: { id: "admin", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
    console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
  },
  assistantSurfaces: {
    app: {
      settingsSurfaceId: "console",
      configScope: "global"
    }
  }
};
`,
      "utf8"
    );

    await assert.rejects(
      () =>
        buildTemplateContext({
          appRoot,
          options: {
            surface: "app",
            "settings-surface": "admin",
            "config-scope": "global"
          }
        }),
      /already has an assistant configured/
    );
  });
});
