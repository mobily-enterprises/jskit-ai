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

async function writeGeneratorPackageWithExamples(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "demo-generator");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/generator",
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
  packageId: "@demo/generator",
  version: "0.1.0",
  kind: "generator",
  description: "Demo generator package for help examples.",
  options: {
    "runtime-surface": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Runtime surface",
      promptHint: "Surface where the generated page will run."
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
  metadata: {
    generatorPrimarySubcommand: "install",
    generatorSubcommands: {
      install: {
        description: "Install the generated package.",
        longDescription: [
          "This command installs the runtime package into the current app.",
          "Use it when you want the generator package to apply its managed files and option contract."
        ],
        examples: [
          {
            label: "App runtime",
            lines: [
              "npx jskit generate @demo/generator install \\\\",
              "  --runtime-surface app"
            ]
          }
        ]
      }
    }
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
    files: [],
    text: []
  }
});
`,
    "utf8"
  );
}

test("generate <generatorId> help points users to subcommand contracts", async () => {
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
    assert.match(stdout, /scaffold \[primary\]/);
    assert.match(stdout, /scaffold-field/);
    assert.match(stdout, /Use subcommand help for positional args, options, notes, and examples:/);
    assert.match(stdout, /\n {2}jskit generate <generatorId> <subcommand> help/);
    assert.doesNotMatch(stdout, /- Use subcommand help for positional args, options, notes, and examples:/);
    assert.doesNotMatch(stdout, /Examples \(\d+\):/);
    assert.doesNotMatch(stdout, /--namespace <text> \[required\]/);
    assert.doesNotMatch(stdout, /Options \(\d+\):/);
  });
});

test("generate feature-server-generator help surfaces primary quick starts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-feature-server-generator-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-feature-server-generator-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "feature-server-generator", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator help: @jskit-ai\/feature-server-generator/);
    assert.match(stdout, /Primary quick starts \(\d+\):/);
    assert.match(stdout, /booking-engine/);
    assert.match(stdout, /availability-engine/);
    assert.match(stdout, /billing-engine/);
  });
});

test("generate rejects runtime packages and points non-CRUD feature work at feature-server-generator", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-runtime-generate-rejection-app");
    await createMinimalApp(appRoot, { name: "discoverability-runtime-generate-rejection-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "auth-web"]
    });

    assert.notEqual(result.status, 0);
    const stderr = String(result.stderr || "");
    assert.match(stderr, /Package @jskit-ai\/auth-web is a runtime package/);
    assert.match(stderr, /Use: jskit add package @jskit-ai\/auth-web/);
    assert.match(stderr, /feature-server-generator scaffold <feature-name>/);
  });
});

test("generate <generatorId> <subcommand> help prints subcommand contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generate-subcommand-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generate-subcommand-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "crud-server-generator", "scaffold-field", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator subcommand help: @jskit-ai\/crud-server-generator scaffold-field/);
    assert.match(stdout, /Positional args \(2\):/);
    assert.match(stdout, /<fieldKey> \[required\]/);
    assert.match(stdout, /<targetFile> \[required\]/);
    assert.match(stdout, /Options \(2\):/);
    assert.match(stdout, /--table-name <text> \[optional; default: <empty>\]/);
    assert.match(stdout, /--id-column <text> \[optional; default: id\]/);
    assert.doesNotMatch(stdout, /--namespace <text> \[required\]/);
  });
});

test("generate <generatorId> help <subcommand> is rejected in favor of <subcommand> help", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generate-primary-subcommand-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generate-primary-subcommand-help-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "crud-server-generator", "help", "scaffold"]
    });

    assert.notEqual(result.status, 0);
    const stderr = String(result.stderr || "");
    assert.match(stderr, /Unknown generator usage:/);
    assert.match(stderr, /Use: jskit generate crud-server-generator <subcommand> help/);
  });
});

test("generate <generatorId> <subcommand> help prints package-provided examples", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "discoverability-generator-example-help-app");
    await createMinimalApp(appRoot, { name: "discoverability-generator-example-help-app" });
    await writeGeneratorPackageWithExamples(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@demo/generator", "install", "help"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assert.match(stdout, /Generator subcommand help: @demo\/generator install/);
    assert.match(stdout, /Long:/);
    assert.match(stdout, /This command installs the runtime package into the current app\./);
    assert.match(stdout, /Examples \(1\):/);
    assert.match(stdout, /App runtime/);
    assert.match(stdout, /npx jskit generate @demo\/generator install \\/);
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
