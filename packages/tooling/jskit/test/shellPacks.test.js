import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, runCli, writeJsonFile } from "./helpers.js";

const SHELL_BUNDLES = ["web-shell", "api-foundations"];

function createPackageDescriptorSource({ packageId, files = [], requires = [] }) {
  const descriptor = {
    packageVersion: 1,
    packageId,
    version: "0.0.1",
    dependsOn: [],
    options: {},
    capabilities: {
      provides: [],
      requires
    },
    mutations: {
      dependencies: {
        runtime: {},
        dev: {}
      },
      packageJson: {
        scripts: {}
      },
      procfile: {},
      files
    }
  };

  return `export default Object.freeze(${JSON.stringify(descriptor, null, 2)});\n`;
}

async function writeLocalPackage({ appRoot, folderName, packageId, files = [], templates = {}, requires = [] }) {
  const packageRoot = path.join(appRoot, "packages", folderName);
  await mkdir(packageRoot, { recursive: true });

  const descriptorSource = createPackageDescriptorSource({
    packageId,
    files,
    requires
  });
  await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorSource, "utf8");

  for (const [templatePath, source] of Object.entries(templates)) {
    const absolutePath = path.join(packageRoot, templatePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, String(source), "utf8");
  }
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-shells-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "shell-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0"
      }
    });

    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

for (const bundleId of SHELL_BUNDLES) {
  test(`shell bundle ${bundleId} can add and doctor cleanly`, async () => {
    await withTempApp(async (appRoot) => {
      const addResult = runCli({
        cwd: appRoot,
        args: ["add", "bundle", bundleId, "--no-install"]
      });
      assert.equal(addResult.status, 0, addResult.stderr);
      assert.match(addResult.stdout, new RegExp(`Added bundle ${bundleId}`));

      const doctorResult = runCli({
        cwd: appRoot,
        args: ["doctor"]
      });
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
    });
  });
}

test("web-shell bundle materializes host scaffold files and switches client entry", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "web-shell", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);
    assert.match(addResult.stdout, /src\/surface\.app\.js/);
    assert.match(addResult.stdout, /src\/layout\.app\.vue/);
    assert.match(addResult.stdout, /src\/surfaces\/admin\/config\.d\/workspace\.entry\.js/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.scripts.dev, "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.js vite");
    assert.equal(packageJson.scripts["dev:app"], "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.app.js vite");
    assert.equal(
      packageJson.scripts["dev:admin"],
      "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.admin.js vite"
    );
    assert.equal(
      packageJson.scripts["dev:console"],
      "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.console.js vite"
    );
    assert.equal(
      packageJson.scripts.build,
      "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.app.js vite build --outDir dist/app"
    );
    assert.equal(
      packageJson.scripts["build:admin"],
      "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.admin.js vite build --outDir dist/admin"
    );
    assert.equal(
      packageJson.scripts["build:console"],
      "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.console.js vite build --outDir dist/console"
    );
    assert.equal(packageJson.scripts["web-shell:generate"], "node ./scripts/web-shell/generate-filesystem-manifest.mjs");

    const requiredScaffoldPaths = [
      "src/surface.js",
      "src/surface.app.js",
      "src/surface.admin.js",
      "src/surface.console.js",
      "src/layout.app.vue",
      "src/layout.admin.vue",
      "src/layout.console.vue",
      "src/runtime/router.js",
      "src/runtime/filesystemHost.js",
      "src/runtime/filesystemHost.app.js",
      "src/runtime/filesystemHost.admin.js",
      "src/runtime/filesystemHost.console.js",
      "src/pages/app/index.vue",
      "src/pages/admin/index.vue",
      "src/pages/console/index.vue",
      "src/surfaces/app/drawer.d/home.entry.js",
      "src/surfaces/admin/config.d/workspace.entry.js",
      "src/surfaces/console/drawer.d/overview.entry.js"
    ];

    for (const relativePath of requiredScaffoldPaths) {
      await access(path.join(appRoot, relativePath));
    }
  });
});

test("web-shell generator picks up package-injected pages and shell entries", async () => {
  await withTempApp(async (appRoot) => {
    const addWebShell = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "web-shell", "--no-install"]
    });
    assert.equal(addWebShell.status, 0, addWebShell.stderr);

    await writeLocalPackage({
      appRoot,
      folderName: "shell-module-example",
      packageId: "@test/shell-module-example",
      requires: ["runtime.web-shell-host"],
      files: [
        {
          from: "templates/src/pages/admin/errors/server.vue",
          to: "src/pages/admin/errors/server.vue"
        },
        {
          from: "templates/src/surfaces/admin/drawer/server-errors.entry.js",
          to: "src/surfaces/admin/drawer.d/server-errors.entry.js"
        }
      ],
      templates: {
        "templates/src/pages/admin/errors/server.vue": "<template><section>Server errors</section></template>\n",
        "templates/src/surfaces/admin/drawer/server-errors.entry.js":
          "export default Object.freeze({ id: \"admin-server-errors\", title: \"Server errors\", route: \"/errors/server\", order: 45 });\n"
      }
    });

    const addFeaturePackage = runCli({
      cwd: appRoot,
      args: ["add", "package", "@test/shell-module-example", "--no-install"]
    });
    assert.equal(addFeaturePackage.status, 0, addFeaturePackage.stderr);

    const generateManifest = spawnSync(process.execPath, ["scripts/web-shell/generate-filesystem-manifest.mjs"], {
      cwd: appRoot,
      encoding: "utf8"
    });
    assert.equal(generateManifest.status, 0, generateManifest.stderr);

    const generatedManifestPath = path.join(appRoot, "src", "runtime", "generated", "filesystemManifest.generated.js");
    const manifestSource = await readFile(generatedManifestPath, "utf8");
    assert.match(manifestSource, /\"\/admin\/errors\/server\"/);
    assert.match(manifestSource, /\"admin-server-errors\"/);
  });
});
