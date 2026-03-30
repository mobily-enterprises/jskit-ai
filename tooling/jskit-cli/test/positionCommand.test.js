import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
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
      'config.surfaceDefaultId = "app";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.app = { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true, requiresAuth: true, requiresWorkspace: true };',
      'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true };',
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(appRoot, "config", "server.js"), "export const config = {};\n", "utf8");
  await writeFile(path.join(appRoot, "src", "placement.js"), "export default [];\n", "utf8");
}

async function createPositionTargetPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "position-target");
  await mkdir(path.join(packageRoot, "src", "client", "providers"), { recursive: true });
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/position-target",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "src", "client", "providers", "Provider.js"),
    "class Provider { static id = \"demo.position-target\"; register() {} }\nexport { Provider };\n",
    "utf8"
  );
  await writeFile(path.join(packageRoot, "templates", "page.vue"), "<template>position target page</template>\n", "utf8");
  await writeFile(path.join(packageRoot, "templates", "non-position.txt"), "NON_POSITIONING_FILE\n", "utf8");
  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/position-target",
  version: "0.1.0",
  kind: "runtime",
  description: "position command test package",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: {
      providers: [{ entrypoint: "src/client/providers/Provider.js", export: "Provider" }]
    }
  },
  options: {
    surfaces: {
      required: true,
      defaultFromConfig: "surfaceDefaultId"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {
        "demo:position-target": "echo position-target"
      }
    },
    files: [
      {
        from: "templates/page.vue",
        toSurface: "\${option:surfaces|lower}",
        toSurfacePath: "workspace/position-target/index.vue",
        id: "position-target-surface-page"
      },
      {
        from: "templates/non-position.txt",
        to: "src/generated/non-position.txt",
        id: "position-target-non-position-file"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        value: "\\n// position-target \${option:surfaces|lower}\\n",
        skipIfContains: ["// position-target \${option:surfaces|lower}"],
        id: "position-target-placement"
      },
      {
        op: "append-text",
        file: "src/generated/non-position.txt",
        value: "\\nNON_POSITIONING_TEXT\\n",
        skipIfContains: ["NON_POSITIONING_TEXT"],
        id: "position-target-non-position-text"
      }
    ]
  }
});\n`,
    "utf8"
  );
}

test("position element applies only positioning mutations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "position-command-app");
    await createMinimalApp(appRoot, { name: "position-command-app" });
    await createPositionTargetPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/position-target", "--surfaces", "app"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const packageJsonPath = path.join(appRoot, "package.json");
    const nonPositionPath = path.join(appRoot, "src", "generated", "non-position.txt");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    delete packageJson.scripts["demo:position-target"];
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    await rm(nonPositionPath);

    const positionResult = runCli({
      cwd: appRoot,
      args: ["position", "element", "@demo/position-target", "--surfaces", "admin"]
    });
    assert.equal(positionResult.status, 0, String(positionResult.stderr || ""));
    assert.match(String(positionResult.stdout || ""), /Positioned element @demo\/position-target/);

    const adminPage = await readFile(
      path.join(appRoot, "src", "pages", "w/[workspaceSlug]/admin/workspace/position-target/index.vue"),
      "utf8"
    );
    assert.match(adminPage, /position target page/);

    let nonPositionExists = true;
    try {
      await readFile(nonPositionPath, "utf8");
    } catch {
      nonPositionExists = false;
    }
    assert.equal(nonPositionExists, false, "position command should not recreate non-position files");

    const postPositionPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(
      Object.prototype.hasOwnProperty.call(postPositionPackageJson.scripts || {}, "demo:position-target"),
      false,
      "position command should not re-apply non-position packageJson scripts mutation"
    );

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const lockEntry = lock.installedPackages["@demo/position-target"];
    assert.ok(lockEntry);
    assert.equal(lockEntry.options.surfaces, "admin");
    assert.ok(
      Object.prototype.hasOwnProperty.call(lockEntry.managed.text, "src/placement.js::position-target-placement")
    );
  });
});

test("position element fails when target is not installed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "position-command-missing");
    await createMinimalApp(appRoot, { name: "position-command-missing" });

    const result = runCli({
      cwd: appRoot,
      args: ["position", "element", "@demo/missing"]
    });

    assert.equal(result.status, 1);
    assert.match(String(result.stderr || ""), /Element is not installed: @demo\/missing/);
  });
});
