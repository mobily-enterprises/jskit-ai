import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runCli as runCliDirect } from "../src/server/index.js";
import { readFileSync, readJsonFile, runCli, writeJsonFile } from "./helpers.js";

function createPackageDescriptorSource({
  packageId,
  dependsOn = [],
  options = {},
  provides = [],
  requires = [],
  runtimeDependencies = {},
  devDependencies = {},
  scripts = {},
  procfile = {},
  files = []
}) {
  const descriptor = {
    packageVersion: 1,
    packageId,
    version: "0.0.1",
    dependsOn,
    options,
    capabilities: {
      provides,
      requires
    },
    mutations: {
      dependencies: {
        runtime: runtimeDependencies,
        dev: devDependencies
      },
      packageJson: {
        scripts
      },
      procfile,
      files
    }
  };

  return `export default Object.freeze(${JSON.stringify(descriptor, null, 2)});\n`;
}

async function writeLocalPackage({
  appRoot,
  folderName,
  packageId,
  dependsOn = [],
  options = {},
  provides = [],
  requires = [],
  runtimeDependencies = {},
  devDependencies = {},
  scripts = {},
  procfile = {},
  files = [],
  templates = {}
}) {
  const packageRoot = path.join(appRoot, "packages", folderName);
  await mkdir(packageRoot, { recursive: true });

  const descriptorSource = createPackageDescriptorSource({
    packageId,
    dependsOn,
    options,
    provides,
    requires,
    runtimeDependencies,
    devDependencies,
    scripts,
    procfile,
    files
  });

  await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorSource, "utf8");

  for (const [templatePath, templateSource] of Object.entries(templates)) {
    const absoluteTemplatePath = path.join(packageRoot, templatePath);
    await mkdir(path.dirname(absoluteTemplatePath), { recursive: true });
    await writeFile(absoluteTemplatePath, String(templateSource), "utf8");
  }
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-pkg-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "temp-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start",
        server: "jskit-app-scripts server"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0",
        fastify: "^5.7.4"
      },
      devDependencies: {}
    });

    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

function createWritableTTY() {
  let buffer = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += String(chunk);
      callback();
    }
  });
  stream.isTTY = true;
  stream.getContents = () => buffer;
  return stream;
}

test("add package installs local package descriptor mutations", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "basic-feature",
      packageId: "@test/basic-feature",
      runtimeDependencies: {
        nanoid: "^5.1.6"
      },
      scripts: {
        "feature:run": "node ./feature.js"
      },
      files: [
        {
          from: "templates/feature.txt",
          to: "feature.txt"
        }
      ],
      templates: {
        "templates/feature.txt": "feature:ok\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@test/basic-feature", "--no-install"]
    });

    assert.equal(addResult.status, 0, addResult.stderr);
    assert.match(addResult.stdout, /Added package @test\/basic-feature/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.dependencies.nanoid, "^5.1.6");
    assert.equal(packageJson.scripts["feature:run"], "node ./feature.js");

    const featureFile = readFileSync(path.join(appRoot, "feature.txt"), "utf8");
    assert.equal(featureFile, "feature:ok\n");

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@test/basic-feature"]);
  });
});

test("remove package keeps shared managed scripts until last owner is removed", async () => {
  await withTempApp(async (appRoot) => {
    const sharedScript = {
      "shared:task": "node ./shared-task.js"
    };

    await writeLocalPackage({
      appRoot,
      folderName: "shared-a",
      packageId: "@test/shared-a",
      scripts: sharedScript
    });

    await writeLocalPackage({
      appRoot,
      folderName: "shared-b",
      packageId: "@test/shared-b",
      scripts: sharedScript
    });

    const addA = runCli({ cwd: appRoot, args: ["add", "package", "@test/shared-a", "--no-install"] });
    const addB = runCli({ cwd: appRoot, args: ["add", "package", "@test/shared-b", "--no-install"] });
    assert.equal(addA.status, 0, addA.stderr);
    assert.equal(addB.status, 0, addB.stderr);

    const removeA = runCli({ cwd: appRoot, args: ["remove", "package", "@test/shared-a"] });
    assert.equal(removeA.status, 0, removeA.stderr);

    let packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.scripts["shared:task"], "node ./shared-task.js");

    const removeB = runCli({ cwd: appRoot, args: ["remove", "package", "@test/shared-b"] });
    assert.equal(removeB.status, 0, removeB.stderr);

    packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.scripts["shared:task"], undefined);
  });
});

test("update package reapplies descriptor changes", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "reapply-package",
      packageId: "@test/reapply-package",
      files: [
        {
          from: "templates/config.txt",
          to: "config.txt"
        }
      ],
      templates: {
        "templates/config.txt": "version=1\n"
      }
    });

    const addResult = runCli({ cwd: appRoot, args: ["add", "package", "@test/reapply-package", "--no-install"] });
    assert.equal(addResult.status, 0, addResult.stderr);

    await writeFile(
      path.join(appRoot, "packages", "reapply-package", "templates", "config.txt"),
      "version=2\n",
      "utf8"
    );

    const updateResult = runCli({ cwd: appRoot, args: ["update", "package", "@test/reapply-package", "--no-install"] });
    assert.equal(updateResult.status, 0, updateResult.stderr);
    assert.match(updateResult.stdout, /Updated package @test\/reapply-package/);

    const configSource = await readFile(path.join(appRoot, "config.txt"), "utf8");
    assert.equal(configSource, "version=2\n");
  });
});

test("required package option fails in non-interactive mode and prompts in interactive mode", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "optioned-package",
      packageId: "@test/optioned-package",
      options: {
        provider: {
          required: true,
          values: ["mysql", "postgres"]
        }
      }
    });

    const nonInteractiveResult = runCli({ cwd: appRoot, args: ["add", "package", "@test/optioned-package", "--no-install"] });
    assert.notEqual(nonInteractiveResult.status, 0);
    assert.match(nonInteractiveResult.stderr, /non-interactive mode requires --provider/i);

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.end("mysql\n");

    const stdout = createWritableTTY();
    const stderr = createWritableTTY();
    const exitCode = await runCliDirect(["add", "package", "@test/optioned-package", "--no-install"], {
      cwd: appRoot,
      stdin,
      stdout,
      stderr
    });

    assert.equal(exitCode, 0, stderr.getContents());
    assert.match(stdout.getContents(), /Select provider for package @test\/optioned-package/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.equal(lock.installedPackages["@test/optioned-package"].options.provider, "mysql");
  });
});

test("managed-file-drift conflict rolls back update package", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "file-drift-package",
      packageId: "@test/file-drift-package",
      files: [
        {
          from: "templates/file.txt",
          to: "drift-file.txt"
        }
      ],
      templates: {
        "templates/file.txt": "original\n"
      }
    });

    const addResult = runCli({ cwd: appRoot, args: ["add", "package", "@test/file-drift-package", "--no-install"] });
    assert.equal(addResult.status, 0, addResult.stderr);

    await writeFile(path.join(appRoot, "drift-file.txt"), "manual edit\n", "utf8");
    await writeFile(
      path.join(appRoot, "packages", "file-drift-package", "templates", "file.txt"),
      "descriptor update\n",
      "utf8"
    );

    const updateResult = runCli({ cwd: appRoot, args: ["update", "package", "@test/file-drift-package", "--no-install"] });
    assert.notEqual(updateResult.status, 0);
    assert.match(updateResult.stderr, /\[managed-file-drift\]/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@test/file-drift-package"]);
  });
});

test("managed-script-drift conflict rolls back update package", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "script-drift-package",
      packageId: "@test/script-drift-package",
      scripts: {
        "sync:data": "node ./sync.js"
      }
    });

    const addResult = runCli({ cwd: appRoot, args: ["add", "package", "@test/script-drift-package", "--no-install"] });
    assert.equal(addResult.status, 0, addResult.stderr);

    const packageJsonPath = path.join(appRoot, "package.json");
    const packageJson = await readJsonFile(packageJsonPath);
    packageJson.scripts["sync:data"] = "node ./custom-sync.js";
    await writeJsonFile(packageJsonPath, packageJson);

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@test/script-drift-package", "--no-install"]
    });
    assert.notEqual(updateResult.status, 0);
    assert.match(updateResult.stderr, /\[managed-script-drift\]/);

    const persistedPackageJson = await readJsonFile(packageJsonPath);
    assert.equal(persistedPackageJson.scripts["sync:data"], "node ./custom-sync.js");
  });
});

test("capability-violation conflict rolls back remove package", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "provider-package",
      packageId: "@test/provider-package",
      provides: ["cap.alpha"]
    });

    await writeLocalPackage({
      appRoot,
      folderName: "consumer-package",
      packageId: "@test/consumer-package",
      requires: ["cap.alpha"]
    });

    const addProvider = runCli({ cwd: appRoot, args: ["add", "package", "@test/provider-package", "--no-install"] });
    const addConsumer = runCli({ cwd: appRoot, args: ["add", "package", "@test/consumer-package", "--no-install"] });
    assert.equal(addProvider.status, 0, addProvider.stderr);
    assert.equal(addConsumer.status, 0, addConsumer.stderr);

    const removeProvider = runCli({ cwd: appRoot, args: ["remove", "package", "@test/provider-package"] });
    assert.notEqual(removeProvider.status, 0);
    assert.match(removeProvider.stderr, /\[capability-violation\]/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@test/provider-package"]);
    assert.ok(lock.installedPackages["@test/consumer-package"]);
  });
});

test("adding a consumer fails when multiple providers satisfy one required capability", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "provider-a",
      packageId: "@test/provider-a",
      provides: ["cap.alpha"]
    });

    await writeLocalPackage({
      appRoot,
      folderName: "provider-b",
      packageId: "@test/provider-b",
      provides: ["cap.alpha"]
    });

    await writeLocalPackage({
      appRoot,
      folderName: "consumer-ambiguous",
      packageId: "@test/consumer-ambiguous",
      requires: ["cap.alpha"]
    });

    const addProviderA = runCli({ cwd: appRoot, args: ["add", "package", "@test/provider-a", "--no-install"] });
    const addProviderB = runCli({ cwd: appRoot, args: ["add", "package", "@test/provider-b", "--no-install"] });
    assert.equal(addProviderA.status, 0, addProviderA.stderr);
    assert.equal(addProviderB.status, 0, addProviderB.stderr);

    const addConsumer = runCli({ cwd: appRoot, args: ["add", "package", "@test/consumer-ambiguous", "--no-install"] });
    assert.notEqual(addConsumer.status, 0);
    assert.match(addConsumer.stderr, /\[capability-violation\]/);
    assert.match(addConsumer.stderr, /multiple installed providers/i);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.equal(lock.installedPackages["@test/consumer-ambiguous"], undefined);
  });
});

test("unresolved-dependency conflict is surfaced for missing package dependencies", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "missing-dep-package",
      packageId: "@test/missing-dep-package",
      dependsOn: ["@test/not-installed"]
    });

    const addResult = runCli({ cwd: appRoot, args: ["add", "package", "@test/missing-dep-package", "--no-install"] });
    assert.notEqual(addResult.status, 0);
    assert.match(addResult.stderr, /\[unresolved-dependency\]/);

    await assert.rejects(access(path.join(appRoot, ".jskit/lock.json")), /ENOENT/);
  });
});

test("add package JSON output includes transaction journal", async () => {
  await withTempApp(async (appRoot) => {
    await writeLocalPackage({
      appRoot,
      folderName: "json-journal-package",
      packageId: "@test/json-journal-package",
      scripts: {
        "journal:test": "node ./journal.js"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@test/json-journal-package", "--no-install", "--json"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);

    const payload = JSON.parse(addResult.stdout);
    assert.equal(payload.command, "add-package");
    assert.equal(payload.packageId, "@test/json-journal-package");
    assert.ok(payload.journal);
    assert.equal(payload.journal.operation, "add");
    assert.ok(Array.isArray(payload.journal.packageOperations));
    assert.ok(payload.journal.packageOperations.length >= 1);
  });
});
