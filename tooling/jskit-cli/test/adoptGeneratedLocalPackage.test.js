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
  await mkdir(appRoot, { recursive: true });
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
}

async function createScaffolderPackage(appRoot, { installationMode = "" } = {}) {
  const scaffolderRoot = path.join(appRoot, "packages", "scaffolder");
  await mkdir(path.join(scaffolderRoot, "src", "server"), { recursive: true });
  await mkdir(path.join(scaffolderRoot, "templates", "generated", "src", "server"), { recursive: true });

  await writeFile(
    path.join(scaffolderRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/scaffolder",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(scaffolderRoot, "src", "server", "ScaffolderProvider.js"),
    "class ScaffolderProvider { static id = \"demo.scaffolder\"; register() {} boot() {} }\nexport { ScaffolderProvider };\n",
    "utf8"
  );

  await writeFile(
    path.join(scaffolderRoot, "templates", "generated", "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/generated-feature",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(scaffolderRoot, "templates", "generated", "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/generated-feature",
  version: "0.1.0",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/GeneratedProvider.js", export: "GeneratedProvider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: []
  }
});\n`,
    "utf8"
  );

  await writeFile(
    path.join(scaffolderRoot, "templates", "generated", "src", "server", "GeneratedProvider.js"),
    "class GeneratedProvider { static id = \"demo.generated\"; register() {} boot() {} }\nexport { GeneratedProvider };\n",
    "utf8"
  );

  const installationModeLine = installationMode ? `  installationMode: "${installationMode}",\n` : "";
  await writeFile(
    path.join(scaffolderRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/scaffolder",
  version: "0.1.0",
${installationModeLine}  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/ScaffolderProvider.js", export: "ScaffolderProvider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@demo/generated-feature": "file:packages/generated-feature"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/generated/package.json",
        to: "packages/generated-feature/package.json"
      },
      {
        from: "templates/generated/package.descriptor.mjs",
        to: "packages/generated-feature/package.descriptor.mjs"
      },
      {
        from: "templates/generated/src/server/GeneratedProvider.js",
        to: "packages/generated-feature/src/server/GeneratedProvider.js"
      }
    ]
  }
});\n`,
    "utf8"
  );
}

test("add package adopts generated app-local package dependency into lock", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "adopt-generated-local-package-app");
    await createMinimalApp(appRoot, { name: "adopt-generated-local-package-app" });
    await createScaffolderPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/scaffolder", "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.ok(lock.installedPackages["@demo/scaffolder"]);
    assert.ok(lock.installedPackages["@demo/generated-feature"]);
    assert.equal(lock.installedPackages["@demo/generated-feature"].source.type, "app-local-package");

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo/generated-feature"], "file:packages/generated-feature");
  });
});

test("add package does not install clone-only scaffold package itself", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "adopt-clone-only-scaffolder-app");
    await createMinimalApp(appRoot, { name: "adopt-clone-only-scaffolder-app" });
    await createScaffolderPackage(appRoot, { installationMode: "clone-only" });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/scaffolder", "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.equal(lock.installedPackages["@demo/scaffolder"], undefined);
    assert.ok(lock.installedPackages["@demo/generated-feature"]);
    assert.equal(lock.installedPackages["@demo/generated-feature"].source.type, "app-local-package");

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo/scaffolder"], undefined);
    assert.equal(appPackageJson.dependencies["@demo/generated-feature"], "file:packages/generated-feature");
  });
});
