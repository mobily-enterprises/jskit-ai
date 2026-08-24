import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { isCliEntrypoint, parseArgs } from "../scripts/jskit.mjs";
import {
  CHECK_SCRIPT,
  UPDATE_SCRIPT,
  checkProject,
  collectLockInstallations,
  discoverProjectManifests,
  updateProject
} from "../scripts/project-packages.mjs";

const CATALOG = Object.freeze({
  schemaVersion: 3,
  release: {
    packages: {
      "@jskit-ai/assistant-runtime": "0.1.7",
      "@jskit-ai/jskit-catalog": "0.1.9",
      "@jskit-ai/shell-web": "0.1.4"
    },
    singletonPackages: [
      "@jskit-ai/assistant-runtime",
      "@jskit-ai/shell-web"
    ]
  }
});
const execFileAsync = promisify(execFile);

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, json(value), "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

test("bundled catalog publishes the coordinated release and singleton contract", async () => {
  const [catalog, packageJson, kernelPackageJson] = await Promise.all([
    readJson(new URL("../catalog/packages.json", import.meta.url)),
    readJson(new URL("../package.json", import.meta.url)),
    readJson(new URL("../../../packages/kernel/package.json", import.meta.url))
  ]);

  assert.equal(catalog.schemaVersion, 3);
  assert.equal(catalog.release.packages[packageJson.name], packageJson.version);
  assert.equal(
    catalog.release.packages[kernelPackageJson.name],
    kernelPackageJson.version
  );
  assert.ok(catalog.release.singletonPackages.includes("@jskit-ai/kernel"));
  assert.ok(catalog.release.singletonPackages.includes("@jskit-ai/assistant-runtime"));
});

async function withProject(run) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-project-packages-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("project discovery follows root npm workspaces, including recursive patterns", async () => {
  await withProject(async (projectRoot) => {
    await writeJson(path.join(projectRoot, "package.json"), {
      name: "example-app",
      private: true,
      workspaces: ["apps/*", "packages/**"]
    });
    await writeJson(path.join(projectRoot, "apps/admin/package.json"), { name: "admin" });
    await writeJson(path.join(projectRoot, "packages/features/reports/package.json"), { name: "reports" });
    await writeJson(path.join(projectRoot, "examples/ignored/package.json"), { name: "ignored" });

    const manifests = await discoverProjectManifests(projectRoot);

    assert.deepEqual(
      manifests.map((entry) => path.relative(projectRoot, entry.absolutePath).split(path.sep).join("/")),
      [
        "package.json",
        "apps/admin/package.json",
        "packages/features/reports/package.json"
      ]
    );
  });
});

test("project updates align root and workspace declarations without changing non-JSKIT dependencies", async () => {
  await withProject(async (projectRoot) => {
    const rootManifestPath = path.join(projectRoot, "package.json");
    const workspaceManifestPath = path.join(projectRoot, "apps/admin/package.json");
    await writeJson(rootManifestPath, {
      name: "example-app",
      private: true,
      workspaces: ["apps/*"],
      scripts: { verify: "npm test" },
      dependencies: {
        "@jskit-ai/shell-web": "0.1.2",
        vue: "^3.5.0"
      }
    });
    await writeJson(workspaceManifestPath, {
      name: "admin",
      private: true,
      devDependencies: {
        "@jskit-ai/assistant-runtime": "0.1.3",
        vite: "^7.0.0"
      }
    });

    let installCalls = 0;
    const result = await updateProject({
      projectRoot,
      catalog: CATALOG,
      async installProject(installRoot) {
        installCalls += 1;
        assert.equal(installRoot, projectRoot);
        assert.equal((await readJson(rootManifestPath)).dependencies["@jskit-ai/shell-web"], "0.1.4");
        assert.equal(
          (await readJson(workspaceManifestPath)).devDependencies["@jskit-ai/assistant-runtime"],
          "0.1.7"
        );
        await writeJson(path.join(projectRoot, "package-lock.json"), {
          name: "example-app",
          lockfileVersion: 3,
          packages: {
            "": { name: "example-app" },
            "apps/admin": { name: "admin" },
            "node_modules/@jskit-ai/assistant-runtime": { version: "0.1.7" },
            "node_modules/@jskit-ai/jskit-catalog": { version: "0.1.9" },
            "node_modules/@jskit-ai/shell-web": { version: "0.1.4" }
          }
        });
      }
    });

    assert.equal(installCalls, 1);
    assert.deepEqual(result.changedFiles, ["package.json", "apps/admin/package.json"]);
    const rootManifest = await readJson(rootManifestPath);
    const workspaceManifest = await readJson(workspaceManifestPath);
    assert.equal(rootManifest.dependencies["@jskit-ai/shell-web"], "0.1.4");
    assert.equal(rootManifest.dependencies.vue, "^3.5.0");
    assert.equal(rootManifest.devDependencies["@jskit-ai/jskit-catalog"], "0.1.9");
    assert.equal(rootManifest.scripts["jskit:update"], UPDATE_SCRIPT);
    assert.equal(rootManifest.scripts["jskit:check"], CHECK_SCRIPT);
    assert.equal(rootManifest.scripts.verify, "npm test");
    assert.equal(workspaceManifest.devDependencies["@jskit-ai/assistant-runtime"], "0.1.7");
    assert.equal(workspaceManifest.devDependencies.vite, "^7.0.0");
    assert.equal((await checkProject({ projectRoot, catalog: CATALOG })).ok, true);
  });
});

test("project checks report stale declarations, mixed cohorts, and nested singleton stacks", async () => {
  await withProject(async (projectRoot) => {
    await writeJson(path.join(projectRoot, "package.json"), {
      name: "example-app",
      private: true,
      workspaces: ["apps/*"],
      dependencies: {
        "@jskit-ai/assistant-runtime": "0.1.6",
        "@jskit-ai/shell-web": "0.1.4"
      }
    });
    await writeJson(path.join(projectRoot, "apps/admin/package.json"), {
      name: "admin",
      private: true,
      dependencies: { "@jskit-ai/shell-web": "0.1.4" }
    });
    await writeJson(path.join(projectRoot, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": { name: "example-app" },
        "node_modules/@jskit-ai/assistant-runtime": { version: "0.1.5" },
        "node_modules/@jskit-ai/shell-web": { version: "0.1.4" },
        "node_modules/@jskit-ai/assistant-runtime/node_modules/@jskit-ai/shell-web": {
          version: "0.1.3"
        }
      }
    });

    const result = await checkProject({ projectRoot, catalog: CATALOG });

    assert.equal(result.ok, false);
    assert.match(result.issues.join("\n"), /assistant-runtime.*0\.1\.6.*expected 0\.1\.7/u);
    assert.match(result.issues.join("\n"), /assistant-runtime@0\.1\.5.*expected 0\.1\.7/u);
    assert.match(result.issues.join("\n"), /shell-web@0\.1\.3.*expected 0\.1\.4/u);
    assert.match(result.issues.join("\n"), /shell-web resolves multiple release versions: 0\.1\.3, 0\.1\.4/u);
    assert.match(result.issues.join("\n"), /shell-web is a singleton client runtime.*2 private install paths/u);
  });
});

test("project updates reject unknown JSKIT declarations before changing any manifest", async () => {
  await withProject(async (projectRoot) => {
    const manifestPath = path.join(projectRoot, "package.json");
    await writeJson(manifestPath, {
      name: "example-app",
      private: true,
      dependencies: { "@jskit-ai/not-in-catalog": "0.1.1" }
    });
    const before = await readFile(manifestPath, "utf8");

    await assert.rejects(
      updateProject({ projectRoot, catalog: CATALOG, install: false }),
      /missing from the coordinated catalog.*@jskit-ai\/not-in-catalog/u
    );
    assert.equal(await readFile(manifestPath, "utf8"), before);
  });
});

test("project updates reject private JSKIT overrides before changing manifests or installing", async () => {
  await withProject(async (projectRoot) => {
    const manifestPath = path.join(projectRoot, "package.json");
    await writeJson(manifestPath, {
      name: "example-app",
      private: true,
      dependencies: { "@jskit-ai/shell-web": "0.1.3" },
      overrides: { "@jskit-ai/shell-web": "0.1.2" }
    });
    const before = await readFile(manifestPath, "utf8");
    let installCalls = 0;

    await assert.rejects(
      updateProject({
        projectRoot,
        catalog: CATALOG,
        async installProject() {
          installCalls += 1;
        }
      }),
      /private JSKIT overrides.*package\.json#overrides\.@jskit-ai\/shell-web/u
    );
    assert.equal(installCalls, 0);
    assert.equal(await readFile(manifestPath, "utf8"), before);
  });
});

test("lockfile collection recognizes root and privately nested scoped packages", () => {
  assert.deepEqual(collectLockInstallations({
    lockfileVersion: 3,
    packages: {
      "node_modules/@jskit-ai/shell-web": { version: "0.1.4" },
      "node_modules/@jskit-ai/assistant-runtime/node_modules/@jskit-ai/shell-web": {
        version: "0.1.3"
      },
      "node_modules/vue": { version: "3.5.0" }
    }
  }), [
    {
      packageId: "@jskit-ai/shell-web",
      version: "0.1.4",
      path: "node_modules/@jskit-ai/shell-web"
    },
    {
      packageId: "@jskit-ai/shell-web",
      version: "0.1.3",
      path: "node_modules/@jskit-ai/assistant-runtime/node_modules/@jskit-ai/shell-web"
    }
  ]);
});

test("jskit CLI parses supported update and check options", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    command: "help",
    projectRoot: process.cwd(),
    install: true
  });
  assert.deepEqual(parseArgs(["update", "--root", "/tmp/example", "--no-install"]), {
    command: "update",
    projectRoot: path.resolve("/tmp/example"),
    install: false
  });
  assert.deepEqual(parseArgs(["check", "--root=/tmp/example"]), {
    command: "check",
    projectRoot: path.resolve("/tmp/example"),
    install: true
  });
  assert.throws(() => parseArgs(["check", "--no-install"]), /only valid with jskit update/u);
  assert.throws(() => parseArgs(["upgrade"]), /Usage:/u);
});

test("jskit CLI recognizes the npm bin symlink as its executable entrypoint", async () => {
  await withProject(async (projectRoot) => {
    const executablePath = path.join(projectRoot, "jskit");
    await symlink(new URL("../scripts/jskit.mjs", import.meta.url), executablePath);

    assert.equal(isCliEntrypoint(executablePath), true);
  });
});

test("jskit CLI updates a project through its npm-style executable symlink", async () => {
  await withProject(async (projectRoot) => {
    const executablePath = path.join(projectRoot, "jskit");
    await symlink(new URL("../scripts/jskit.mjs", import.meta.url), executablePath);
    await writeJson(path.join(projectRoot, "package.json"), {
      name: "example-app",
      private: true,
      dependencies: { "@jskit-ai/kernel": "0.0.1" }
    });

    const { stdout } = await execFileAsync(executablePath, [
      "update",
      "--root",
      projectRoot,
      "--no-install"
    ]);
    const catalog = await readJson(new URL("../catalog/packages.json", import.meta.url));
    const manifest = await readJson(path.join(projectRoot, "package.json"));

    assert.equal(manifest.dependencies["@jskit-ai/kernel"], catalog.release.packages["@jskit-ai/kernel"]);
    assert.equal(
      manifest.devDependencies["@jskit-ai/jskit-catalog"],
      catalog.release.packages["@jskit-ai/jskit-catalog"]
    );
    assert.equal(manifest.scripts["jskit:update"], UPDATE_SCRIPT);
    assert.equal(manifest.scripts["jskit:check"], CHECK_SCRIPT);
    assert.match(stdout, /Skipped npm install; run it before jskit check\./u);
  });
});
