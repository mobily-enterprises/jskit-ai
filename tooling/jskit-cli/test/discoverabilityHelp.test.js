import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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

async function writeRuntimePackageWithOptions(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "demo-runtime");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/runtime",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/runtime",
  version: "0.1.0",
  kind: "runtime",
  description: "Demo runtime package for option help tests.",
  options: {
    "workspace-slug": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Workspace slug",
      promptHint: "Route slug for workspace-scoped pages."
    },
    "route-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "ops",
      promptLabel: "Route prefix",
      promptHint: "Optional route prefix."
    }
  },
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {},
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
`,
    "utf8"
  );
}

test("generate <generatorId> help prints generator-specific option contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generate-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generate-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "crud-server-generator", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator help: @jskit-ai\/crud-server-generator/);
    assert.match(stdout, /Subcommands \(\d+\):/);
    assert.match(stdout, /add-table \[primary\]/);
    assert.match(stdout, /add-field/);
    assert.match(stdout, /jskit generate <generatorId> <subcommand> help/);
    assert.match(stdout, /--namespace <text> \[required\]/);
    const namespaceIndex = stdout.indexOf("--namespace <text> [required]");
    const tableNameIndex = stdout.indexOf("--table-name <text> [required]");
    const directoryPrefixIndex = stdout.indexOf("--directory-prefix <text> [optional; default: <empty>]");
    assert.ok(namespaceIndex > -1);
    assert.ok(tableNameIndex > -1);
    assert.ok(directoryPrefixIndex > -1);
    assert.ok(namespaceIndex < directoryPrefixIndex);
    assert.ok(tableNameIndex < directoryPrefixIndex);
    assert.match(stdout, /required options with defaults are auto-filled when omitted/i);
  });
});

test("generate <generatorId> <subcommand> help prints subcommand contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generate-subcommand-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generate-subcommand-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "crud-server-generator", "add-field", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator subcommand help: @jskit-ai\/crud-server-generator add-field/);
    assert.match(stdout, /Positional args \(2\):/);
    assert.match(stdout, /<fieldKey> \[required\]/);
    assert.match(stdout, /<targetFile> \[required\]/);
    assert.match(stdout, /Options \(2\):/);
    assert.match(stdout, /--table-name <text> \[required\]/);
    assert.match(stdout, /--id-column <text> \[optional; default: id\]/);
    assert.doesNotMatch(stdout, /--namespace <text> \[required\]/);
  });
});

test("generate <generatorId> help <subcommand> prints primary subcommand contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generate-primary-subcommand-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generate-primary-subcommand-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "crud-server-generator", "help", "add-table"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator subcommand help: @jskit-ai\/crud-server-generator add-table/);
    assert.match(stdout, /primary generator command/i);
    assert.match(stdout, /Positional args \(0\):/);
    assert.match(stdout, /No positional arguments/);
    assert.match(stdout, /--namespace <text> \[required\]/);
    assert.match(stdout, /--directory-prefix <text> \[optional; default: <empty>\]/);
  });
});

test("add package <packageId> help prints package-specific option contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-add-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-add-help-app" });
    await writeRuntimePackageWithOptions(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/runtime", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Package help: @demo\/runtime/);
    assert.match(stdout, /--workspace-slug <text> \[required\]/);
    assert.match(stdout, /Workspace slug\. Route slug for workspace-scoped pages\./);
    assert.match(stdout, /--route-prefix <text> \[optional; default: ops\]/);
  });
});

test("add <packageId> help supports shorthand package help", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-add-shorthand-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-add-shorthand-help-app" });
    await writeRuntimePackageWithOptions(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["add", "@demo/runtime", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Package help: @demo\/runtime/);
  });
});

test("add bundle <bundleId> help prints bundle-specific help", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-add-bundle-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-add-bundle-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Bundle help: auth-base/);
    assert.match(stdout, /Included packages \(\d+\):/);
    assert.match(stdout, /Inline options:/);
    assert.match(stdout, /jskit add package <packageId> help/);
  });
});
