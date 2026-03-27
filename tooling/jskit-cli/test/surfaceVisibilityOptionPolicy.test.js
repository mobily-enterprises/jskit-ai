import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
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
    [
      "export const config = {};",
      'config.surfaceDefaultId = "home";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.home = { id: "home", pagesRoot: "home", enabled: true, requiresAuth: false, requiresWorkspace: false };',
      'config.surfaceDefinitions.console = { id: "console", pagesRoot: "console", enabled: true, requiresAuth: true, requiresWorkspace: false };',
      'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true };',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function createSurfaceVisibilityPolicyPackage(appRoot, { surfaceOptionName = "surface" } = {}) {
  const packageRoot = path.join(appRoot, "packages", "surface-policy");
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/surface-policy",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "Provider.js"),
    "class Provider { static id = \"demo.surface-policy\"; register() {} boot() {} }\nexport { Provider };\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "templates", "settings.txt"),
    `surface=\${option:${surfaceOptionName}} visibility=\${option:visibility}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/surface-policy",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  options: {
    ${surfaceOptionName}: {
      required: true,
      defaultFromConfig: "surfaceDefaultId"
    },
    visibility: {
      required: true,
      defaultValue: "auto"
    }
  },
  optionPolicies: {
    surfaceVisibility: {
      surfaceOption: "${surfaceOptionName}"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/settings.txt",
        to: "src/generated/settings.txt"
      }
    ]
  }
});\n`,
    "utf8"
  );
}

test("add package fails fast when workspace visibility targets a non-workspace surface", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-visibility-policy-invalid");
    await createMinimalApp(appRoot, { name: "surface-visibility-policy-invalid" });
    await createSurfaceVisibilityPolicyPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/surface-policy",
        "--surface",
        "console",
        "--visibility",
        "workspace",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /Invalid option combination for package @demo\/surface-policy/);
    assert.match(String(addResult.stderr || ""), /requires surfaces with requiresWorkspace=true/);
  });
});

test("add package allows auto visibility on non-workspace surfaces", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-visibility-policy-auto");
    await createMinimalApp(appRoot, { name: "surface-visibility-policy-auto" });
    await createSurfaceVisibilityPolicyPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/surface-policy",
        "--surface",
        "console",
        "--visibility",
        "auto",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    const generated = await readFile(path.join(appRoot, "src/generated/settings.txt"), "utf8");
    assert.equal(generated, "surface=console visibility=auto\n");
  });
});

test("add package validates every surface in comma-separated surface option", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-visibility-policy-multi-unknown");
    await createMinimalApp(appRoot, { name: "surface-visibility-policy-multi-unknown" });
    await createSurfaceVisibilityPolicyPackage(appRoot, { surfaceOptionName: "surfaces" });

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/surface-policy",
        "--surfaces",
        "admin,missing",
        "--visibility",
        "auto",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /includes unknown surface "missing"/);
  });
});

test("add package rejects workspace visibility when any comma-separated surface is non-workspace", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-visibility-policy-multi-workspace");
    await createMinimalApp(appRoot, { name: "surface-visibility-policy-multi-workspace" });
    await createSurfaceVisibilityPolicyPackage(appRoot, { surfaceOptionName: "surfaces" });

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/surface-policy",
        "--surfaces",
        "admin,console",
        "--visibility",
        "workspace",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /requires surfaces with requiresWorkspace=true/);
    assert.match(String(addResult.stderr || ""), /"console" has requiresWorkspace=false/);
  });
});

test("add package accepts comma-separated workspace surfaces", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-visibility-policy-multi-valid");
    await createMinimalApp(appRoot, { name: "surface-visibility-policy-multi-valid" });
    await createSurfaceVisibilityPolicyPackage(appRoot, { surfaceOptionName: "surfaces" });

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/surface-policy",
        "--surfaces",
        "admin,admin",
        "--visibility",
        "workspace",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    const generated = await readFile(path.join(appRoot, "src/generated/settings.txt"), "utf8");
    assert.equal(generated, "surface=admin,admin visibility=workspace\n");
  });
});
